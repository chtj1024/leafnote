'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const M = require('./public/markdown.js');

const STYLE = `
@page{size:A4;margin:18mm 16mm}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;color:#262b25;font:11pt/1.75 'Malgun Gothic','Segoe UI',sans-serif;overflow-wrap:anywhere}
h1,h2,h3{break-after:avoid;page-break-after:avoid;line-height:1.5;margin:1.1em 0 .4em}
h1{font-size:23pt;letter-spacing:-.5px}h2{font-size:17pt;letter-spacing:-.3px}h3{font-size:13.5pt}
p{margin:.35em 0}
a{color:#37664e}
mark{color:inherit;border-radius:2px;padding:1px 0}
code{font:10pt/1.6 Consolas,'Malgun Gothic',monospace;background:#f1f2ee;color:#8a5d44;padding:1px 4px;border-radius:3px}
pre{font:9.5pt/1.65 Consolas,'Malgun Gothic',monospace;background:#f3f4f0;border:1px solid #e1e4dc;border-radius:5px;padding:9px 12px;margin:.6em 0;white-space:pre-wrap;break-inside:avoid-page}
blockquote{margin:.6em 0;padding:.1em 0 .1em 14px;border-left:3px solid #b5c4ab;color:#4a5248}
hr{border:0;border-top:1px solid #d6dacf;margin:1.1em 0}
.li{display:flex;gap:.4em;margin:.12em 0}
.li .mark{flex:0 0 1.6em;text-align:right;padding-right:.2em}
.li.done .text{color:#7d8478;text-decoration:line-through}
.text{flex:1;min-width:0}
table{border-collapse:collapse;width:100%;margin:.7em 0;font-size:10.5pt}
th,td{border:1px solid #cfd4c8;padding:5px 9px;vertical-align:top}
th{background:#eef1ea;font-weight:650}
tr{break-inside:avoid}
figure{margin:.8em 0;text-align:center;break-inside:avoid}
img{max-width:100%;max-height:245mm;object-fit:contain}
.missing{color:#8d6b66;font-size:10pt}
`;

function renderBody(blocks, imageUrl) {
  let number = 0;
  return blocks.map(b => {
    number = b.type === 'number' ? number + 1 : 0;
    const text = M.inline(b.text || '');
    const item = (mark, cls = '') => `<div class="li${cls}" style="margin-left:${(b.indent || 0) * 22}px"><span class="mark">${mark}</span><div class="text">${text}</div></div>`;
    switch (b.type) {
      case 'h1': case 'h2': case 'h3': return `<${b.type}>${text}</${b.type}>`;
      case 'bullet': return item('•');
      case 'number': return item(number + '.');
      case 'todo': return item(b.checked ? '☑' : '☐', b.checked ? ' done' : '');
      case 'quote': return `<blockquote>${text}</blockquote>`;
      case 'code': return `<pre>${M.escape(b.text)}</pre>`;
      case 'divider': return '<hr>';
      case 'table': {
        const row = (cells, tag) => '<tr>' + cells.map((cell, c) => `<${tag} style="text-align:${['left','center','right'].includes(b.aligns?.[c]) ? b.aligns[c] : 'left'}">${M.inline(cell)}</${tag}>`).join('') + '</tr>';
        return `<table><thead>${row(b.rows[0], 'th')}</thead><tbody>${b.rows.slice(1).map(r => row(r, 'td')).join('')}</tbody></table>`;
      }
      case 'image': {
        const src = imageUrl ? imageUrl(b.src) : null;
        return src
          ? `<figure><img src="${M.escape(src)}" alt="${M.escape(b.alt || '')}"></figure>`
          : `<p class="missing">[이미지를 찾을 수 없습니다: ${M.escape(b.alt || b.src)}]</p>`;
      }
      default: return b.text ? `<p>${text}</p>` : '';
    }
  }).join('\n');
}

function renderHtml(markdown, {imageUrl, title = 'Leafnote'} = {}) {
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src file:; style-src \'unsafe-inline\'">' +
    `<title>${M.escape(title)}</title><style>${STYLE}</style></head><body>${renderBody(M.parse(markdown), imageUrl)}</body></html>`;
}

function findBrowser() {
  if (process.env.LEAFNOTE_BROWSER && fs.existsSync(process.env.LEAFNOTE_BROWSER)) return process.env.LEAFNOTE_BROWSER;
  const dirs = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LocalAppData].filter(Boolean);
  const names = [['Microsoft', 'Edge', 'Application', 'msedge.exe'], ['Google', 'Chrome', 'Application', 'chrome.exe']];
  for (const name of names) for (const dir of dirs) {
    const file = path.join(dir, ...name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function fail(message, status = 500) { return Object.assign(new Error(message), {status}); }

// Print the document with headless Edge/Chrome so text, tables, and images match what the page shows.
async function printPdf(html, output, {browser = findBrowser()} = {}) {
  if (!browser) throw fail('PDF를 만들 Microsoft Edge 또는 Chrome을 찾지 못했습니다.');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'leafnote-pdf-'));
  try {
    const page = path.join(work, 'document.html'), pdf = path.join(work, 'document.pdf');
    fs.writeFileSync(page, html, 'utf8');
    await new Promise((resolve, reject) => {
      execFile(browser, [
        '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--user-data-dir=' + path.join(work, 'profile'),
        '--no-pdf-header-footer', '--print-to-pdf=' + pdf,
        pathToFileURL(page).href
      ], {windowsHide: true, timeout: 90000}, err => err ? reject(fail('PDF를 만들지 못했습니다. 잠시 후 다시 시도해주세요.')) : resolve());
    });
    let head;
    try { head = fs.readFileSync(pdf).subarray(0, 5).toString('latin1'); } catch { head = ''; }
    if (head !== '%PDF-') throw fail('PDF를 만들지 못했습니다. 잠시 후 다시 시도해주세요.');
    try { fs.copyFileSync(pdf, output); }
    catch { throw fail('PDF 파일을 저장하지 못했습니다. 저장 위치의 쓰기 권한이나 열려 있는 파일을 확인해주세요.', 403); }
  } finally {
    try { fs.rmSync(work, {recursive: true, force: true}); } catch {}
  }
}

module.exports = {renderHtml, renderBody, printPdf, findBrowser};
