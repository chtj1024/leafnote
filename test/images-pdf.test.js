'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const M = require('../public/markdown');
const {createServer} = require('../server');
const {renderHtml, printPdf, findBrowser} = require('../pdf');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leafnote-images-')), choices = [], printed = [];
  const server = createServer({
    pickFile: async () => choices.shift() || null,
    makePdf: async (html, file) => { printed.push({html, file}); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port, bootstrap = await (await fetch(base + '/api/bootstrap')).json();
  async function request(route, method = 'GET', data, headers = {}) {
    const response = await fetch(base + route, {method, headers: {'Content-Type': 'application/json', 'X-Leafnote-Token': bootstrap.token, ...headers}, body: data === undefined ? undefined : JSON.stringify(data)});
    return {status: response.status, response, value: (response.headers.get('content-type') || '').startsWith('application/json') ? await response.json() : null};
  }
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, {recursive: true, force: true}); });
  const open = async (name = '내 문서 (1).md', body = '# 제목\n') => {
    const file = path.join(dir, name); fs.writeFileSync(file, body);
    return {file, doc: (await request('/api/open-file', 'POST', {path: file})).value};
  };
  return {dir, choices, printed, request, open, base};
}

test('standalone relative image lines become image blocks and round-trip', () => {
  const content = '앞 문단\n![스크린샷](문서.assets/image-1.png)\n\n![](a%20b.assets/x.png)\n';
  const blocks = M.parse(content);
  assert.deepEqual(blocks.map(b => b.type), ['paragraph', 'image', 'image']);
  assert.equal(blocks[1].src, '문서.assets/image-1.png');
  assert.equal(blocks[1].alt, '스크린샷');
  assert.deepEqual(M.parse(M.stringify(blocks)), blocks);
  assert.equal(M.stringify([blocks[2]]), '![](a%20b.assets/x.png)\n');
});

test('remote, data and absolute image links stay ordinary text', () => {
  for (const src of ['https://example.com/a.png', 'data:image/png;base64,AAAA', 'C:/a.png', '/etc/a.png', '\\\\server\\a.png', 'file:///a.png']) {
    assert.equal(M.parse(`![x](${src})`)[0].type, 'paragraph', src);
  }
});

test('pasted images are stored beside the document and served back safely', async t => {
  const e = await setup(t), {file, doc} = await e.open();
  const saved = await e.request(`/api/documents/${doc.id}/images`, 'POST', {data: PNG});
  assert.equal(saved.status, 200);
  assert.match(saved.value.src, /^내%20문서%20%281%29\.assets\/image-\d{8}-\d{6}-[0-9a-f]{4}\.png$/);
  const stored = path.join(e.dir, '내 문서 (1).assets', saved.value.name);
  assert.deepEqual(fs.readFileSync(stored), Buffer.from(PNG, 'base64'));
  assert.equal(fs.readFileSync(file, 'utf8'), '# 제목\n');
  assert.equal(M.parse(`![](${saved.value.src})`)[0].type, 'image');

  const served = await e.request(`/api/documents/${doc.id}/image?src=${encodeURIComponent(saved.value.src)}`);
  assert.equal(served.status, 200);
  assert.equal(served.response.headers.get('content-type'), 'image/png');
  assert.equal(served.response.headers.get('x-content-type-options'), 'nosniff');
});

test('image uploads reject non-images, oversized payloads, bad tokens and unknown documents', async t => {
  const e = await setup(t), {doc} = await e.open();
  assert.equal((await e.request(`/api/documents/${doc.id}/images`, 'POST', {data: Buffer.from('not an image at all').toString('base64')})).status, 415);
  assert.equal((await e.request(`/api/documents/${doc.id}/images`, 'POST', {})).status, 400);
  assert.equal((await e.request(`/api/documents/${doc.id}/images`, 'POST', {data: PNG}, {'X-Leafnote-Token': 'wrong'})).status, 403);
  assert.equal((await e.request('/api/documents/00000000-0000-0000-0000-000000000000/images', 'POST', {data: PNG})).status, 404);
  await assert.rejects(e.request(`/api/documents/${doc.id}/images`, 'POST', {data: 'A'.repeat(28 * 1024 * 1024)}));
  assert.equal(fs.existsSync(path.join(e.dir, '내 문서 (1).assets')), false);
});

test('images can only be read from inside the document folder', async t => {
  const e = await setup(t), {doc} = await e.open();
  const outside = path.join(path.dirname(e.dir), path.basename(e.dir) + '-secret.png');
  fs.writeFileSync(outside, Buffer.from(PNG, 'base64'));
  t.after(() => fs.rmSync(outside, {force: true}));
  fs.writeFileSync(path.join(e.dir, 'notes.txt'), 'secret');
  fs.writeFileSync(path.join(e.dir, 'ok.png'), Buffer.from(PNG, 'base64'));
  const get = src => e.request(`/api/documents/${doc.id}/image?src=${encodeURIComponent(src)}`);
  assert.equal((await get('ok.png')).status, 200);
  assert.equal((await get('../' + path.basename(outside))).status, 403);
  assert.equal((await get('..%2F' + path.basename(outside))).status, 403);
  assert.equal((await get(outside)).status, 400);
  assert.equal((await get('/ok.png')).status, 400);
  assert.equal((await get('notes.txt')).status, 400);
  assert.equal((await get('missing.png')).status, 404);
  assert.equal((await get('')).status, 400);
});

test('PDF export asks for a PDF path and renders every block type including images', async t => {
  const e = await setup(t), {doc} = await e.open();
  const saved = (await e.request(`/api/documents/${doc.id}/images`, 'POST', {data: PNG})).value;
  const markdown = `# 제목\n\n본문 **굵게** <mark style="background-color:#d8cfad">강조</mark>\n\n- 항목\n\n1. 번호\n\n- [x] 완료\n\n> 인용\n\n\`\`\`js\nconst a = "<b>";\n\`\`\`\n\n| 가 | 나 |\n| :--- | ---: |\n| 1 | 2 |\n\n![캡처](${saved.src})\n\n![없음](missing.png)\n\n<script>alert(1)</script>\n`;
  const out = path.join(e.dir, '내보내기.pdf');
  e.choices.push(out);
  const done = await e.request('/api/export-pdf', 'POST', {id: doc.id, title: 'x.md', markdown});
  assert.equal(done.status, 200); assert.equal(done.value.path, out);
  assert.equal(e.printed.length, 1); assert.equal(e.printed[0].file, out);
  const html = e.printed[0].html;
  for (const part of ['<h1>제목</h1>', '<strong>굵게</strong>', '<blockquote>인용</blockquote>', '<pre>const a = &quot;&lt;b&gt;&quot;;</pre>', '<th style="text-align:left">가</th>', '<td style="text-align:right">2</td>', '☑', 'file:///', 'alt="캡처"', '이미지를 찾을 수 없습니다']) assert.ok(html.includes(part), part);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes("default-src 'none'"));

  assert.equal((await e.request('/api/export-pdf', 'POST', {id: doc.id, markdown})).value.cancelled, true);
  e.choices.push(path.join(e.dir, 'wrong.md'));
  assert.equal((await e.request('/api/export-pdf', 'POST', {id: doc.id, markdown})).status, 400);
  assert.equal((await e.request('/api/export-pdf', 'POST', {id: doc.id})).status, 400);
  assert.equal(e.printed.length, 1);
});

test('unsaved documents can still be exported without image folders', async t => {
  const e = await setup(t), out = path.join(e.dir, 'draft.pdf');
  e.choices.push(out);
  const done = await e.request('/api/export-pdf', 'POST', {title: '제목 없는 문서', markdown: '내용\n\n![x](a.png)\n'});
  assert.equal(done.status, 200); assert.ok(e.printed[0].html.includes('이미지를 찾을 수 없습니다'));
});

test('headless browser prints a real PDF with Korean text and an image', { skip: !findBrowser() }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leafnote-pdf-test-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const image = path.join(dir, 'a.png'); fs.writeFileSync(image, Buffer.from(PNG, 'base64'));
  const out = path.join(dir, '결과.pdf');
  await printPdf(renderHtml('# 한글 제목\n\n본문\n\n![a](a.png)\n', {imageUrl: () => require('node:url').pathToFileURL(image).href}), out);
  const bytes = fs.readFileSync(out);
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(bytes.length > 1000);
});
