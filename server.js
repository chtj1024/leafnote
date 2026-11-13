'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = __dirname, MAX_BODY = 5 * 1024 * 1024;
const key = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
// Update the existing file object so Explorer retains its desktop position.
function writeOriginal(file, bytes, original) {
  const fd = fs.openSync(file, original ? 'r+' : 'wx');
  function writeAll(value) {
    let offset = 0;
    while (offset < value.length) {
      const count = fs.writeSync(fd,value,offset,value.length-offset,offset);
      if (!count) throw new Error('파일에 쓰지 못했습니다.');
      offset += count;
    }
    fs.ftruncateSync(fd,value.length); fs.fsyncSync(fd);
  }
  try {
    if (original && !fs.readFileSync(fd).equals(original.bytes)) throw problem('다른 프로그램에서 파일을 수정했습니다. 파일을 다시 열어주세요.',409);
    try { writeAll(bytes); }
    catch (err) {
      // Keep the previous contents when a recoverable write fails.
      if (original) { try { writeAll(original.bytes); } catch {} }
      throw err;
    }
  } finally { fs.closeSync(fd); }
}
const {execFile} = require('node:child_process');
function chooseFile(options) {
  return new Promise((resolve,reject) => {
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const request = Buffer.from(JSON.stringify(options),'utf8').toString('base64');
    execFile(powershell,['-NoProfile','-STA','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'file-picker.ps1'),'-RequestBase64',request],{windowsHide:true,maxBuffer:65536},(err,stdout) => {
      if (err) return reject(problem('파일 선택 창을 열지 못했습니다. 잠시 후 다시 시도해주세요.',500));
      try { resolve(JSON.parse(stdout.trim().replace(/^\uFEFF/,''))); }
      catch { reject(problem('파일 선택 결과를 읽지 못했습니다.',500)); }
    });
  });
}
function problem(message, status = 400) { return Object.assign(new Error(message), { status }); }
function sourceDocument(file, resolve = false) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.(md|markdown)$/i.test(file)) throw problem('기존 .md 또는 .markdown 파일을 선택해주세요.');
  let filename, stat, bytes;
  try {
    filename = resolve ? fs.realpathSync(file) : file;
    stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw problem('일반 마크다운 파일만 열 수 있습니다.');
    if (stat.size > 4 * 1024 * 1024) throw problem('원본 파일은 4MB까지 열 수 있습니다.', 413);
    bytes = fs.readFileSync(filename);
  } catch (err) {
    if (err.status) throw err;
    if (err.code === 'ENOENT') throw problem('원본 파일을 찾을 수 없습니다. 이동한 파일을 다시 열어주세요.',404);
    throw problem('원본 파일을 읽을 수 없습니다. 파일 권한이나 사용 중인 프로그램을 확인해주세요.',403);
  }
  let encoding = 'utf8', bom = false, payload = bytes;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) { bom = true; payload = bytes.subarray(3); }
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'utf16le'; bom = true; payload = bytes.subarray(2); }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'utf16be'; bom = true; payload = bytes.subarray(2); }
  let text;
  try { text = new TextDecoder(encoding === 'utf8' ? 'utf-8' : encoding === 'utf16le' ? 'utf-16le' : 'utf-16be', {fatal:true}).decode(payload); }
  catch { throw problem('UTF-8 또는 BOM이 있는 UTF-16 마크다운 파일만 지원합니다. 파일 인코딩을 확인해주세요.',422); }
  return { path:filename, bytes, text, encoding, bom, eol:text.includes('\r\n') ? '\r\n' : '\n', hash:crypto.createHash('sha256').update(bytes).digest('hex'), modified:stat.mtime.toISOString() };
}
function sourceBytes(page, text) {
  const normalized = text.replace(/\r\n?/g,'\n').replace(/\n/g,page.sourceEol || '\n');
  let bytes = Buffer.from(normalized,page.sourceEncoding === 'utf8' ? 'utf8' : 'utf16le');
  if (page.sourceEncoding === 'utf16be') bytes.swap16();
  if (page.sourceBom) bytes = Buffer.concat([Buffer.from(page.sourceEncoding === 'utf8' ? [0xef,0xbb,0xbf] : page.sourceEncoding === 'utf16be' ? [0xfe,0xff] : [0xff,0xfe]),bytes]);
  return bytes;
}
function sourceFields(source) {
  return { sourcePath:source.path, sourceHash:source.hash, sourceEncoding:source.encoding, sourceBom:source.bom, sourceEol:source.eol };
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function body(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { reject(Object.assign(new Error('문서는 5MB까지 저장할 수 있습니다.'), { status: 413 })); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('올바르지 않은 요청입니다.'), { status: 400 })); } });
    req.on('error', reject);
  });
}

function createServer({pickFile = chooseFile} = {}) {
  let picking = false;
  async function pick(options) {
    if (picking) throw problem('파일 선택 창이 이미 열려 있습니다.',409);
    picking = true;
    try { return await pickFile(options); } finally { picking = false; }
  }
  const TOKEN = crypto.randomBytes(32).toString('hex'), sessions = new Map();
  function publicDocument(doc, markdown) {
    return {id:doc.id,title:path.basename(doc.sourcePath),path:doc.sourcePath,revision:doc.revision,updatedAt:doc.updatedAt,format:{encoding:doc.sourceEncoding,bom:doc.sourceBom,eol:doc.sourceEol},...(markdown === undefined ? {} : {markdown})};
  }
  function readDocument(doc) {
    const source = sourceDocument(doc.sourcePath);
    if (doc.sourceHash !== source.hash) Object.assign(doc,sourceFields(source),{revision:doc.revision+1,updatedAt:source.modified});
    return publicDocument(doc,source.text);
  }
  function openDocument(file) {
    const source = sourceDocument(file,true);
    let doc = [...sessions.values()].find(item => key(item.sourcePath) === key(source.path));
    if (doc) return readDocument(doc);
    doc = {id:crypto.randomUUID(),revision:1,updatedAt:source.modified,...sourceFields(source)};
    sessions.set(doc.id,doc); return publicDocument(doc,source.text);
  }
  function getDocument(id) {
    const doc = sessions.get(id);
    if (!doc) throw problem('파일을 다시 열어주세요. 앱을 재시작하면 열린 파일 정보가 초기화됩니다.',404);
    return doc;
  }
  function checkRevision(doc, revision) {
    if (doc.revision !== revision) throw problem('다른 창에서 파일을 수정했습니다. 다른 이름으로 저장하거나 파일을 다시 열어주세요.',409);
    const source = sourceDocument(doc.sourcePath);
    if (source.hash !== doc.sourceHash) throw problem('다른 프로그램에서 파일을 수정했습니다. 다른 이름으로 저장하거나 파일을 다시 열어주세요.',409);
    return source;
  }
  function bytesFor(doc, markdown) {
    if (typeof markdown !== 'string') throw problem('저장할 문서 내용이 필요합니다.');
    const bytes = sourceBytes(doc || {sourceEncoding:'utf8',sourceEol:'\n'},markdown);
    if (bytes.length > 4*1024*1024) throw problem('파일은 4MB까지 저장할 수 있습니다.',413);
    return bytes;
  }
  const server = http.createServer(async (req,res) => {
    try {
      const PORT = server.address().port, host = `127.0.0.1:${PORT}`;
      if (req.headers.host !== host && req.headers.host !== `localhost:${PORT}`) return json(res,403,{error:'잘못된 호스트입니다.'});
      const url = new URL(req.url,`http://${host}`);
      if (url.pathname.startsWith('/api/')) {
        if (!['GET','HEAD'].includes(req.method)) {
          if (req.headers['x-leafnote-token'] !== TOKEN || !String(req.headers['content-type']).startsWith('application/json')) return json(res,403,{error:'앱에서 다시 시도해주세요.'});
          if (req.headers.origin && ![`http://${host}`,`http://localhost:${PORT}`].includes(req.headers.origin)) return json(res,403,{error:'허용되지 않은 요청입니다.'});
        }
        if (url.pathname === '/api/health' && req.method === 'GET') return json(res,200,{app:'leafnote',version:3,mode:'files',build:'file-editor-inplace-2',root:ROOT});
        if (url.pathname === '/api/bootstrap' && req.method === 'GET') return json(res,200,{token:TOKEN,mode:'files'});
        if (url.pathname === '/api/shutdown' && req.method === 'POST') {
          await body(req); json(res,200,{ok:true}); server.close(); server.closeIdleConnections?.(); return;
        }
        if (url.pathname === '/api/open-file' && req.method === 'POST') return json(res,200,openDocument((await body(req)).path));
        if (url.pathname === '/api/choose-open' && req.method === 'POST') {
          await body(req);
          const file = await pick({kind:'open'});
          return json(res,200,file ? openDocument(file) : {cancelled:true});
        }
        if (url.pathname === '/api/save-as' && req.method === 'POST') {
          const data = await body(req), current = data.id ? getDocument(data.id) : null;
          const format = current || {
            sourceEncoding:['utf8','utf16le','utf16be'].includes(data.format?.encoding) ? data.format.encoding : 'utf8',
            sourceBom:!!data.format?.bom,sourceEol:data.format?.eol === '\r\n' ? '\r\n' : '\n'
          };
          const bytes = bytesFor(format,data.markdown);
          const file = await pick({kind:'save',name:current ? path.basename(current.sourcePath) : '제목 없는 문서.md',directory:current ? path.dirname(current.sourcePath) : ''});
          if (!file) return json(res,200,{cancelled:true});
          if (!path.isAbsolute(file) || !/\.(md|markdown)$/i.test(file)) throw problem('마크다운 파일 이름을 선택해주세요.');
          let original;
          if (fs.existsSync(file)) original = sourceDocument(file,true);
          const destination = original ? original.path : file;
          if (current && key(destination) === key(current.sourcePath)) original = checkRevision(current,data.revision);
          writeOriginal(destination,bytes,original);
          return json(res,200,openDocument(destination));
        }
        const match = url.pathname.match(/^\/api\/documents\/([a-f0-9-]{36})$/);
        if (match) {
          const doc = getDocument(match[1]);
          if (req.method === 'GET') return json(res,200,readDocument(doc));
          if (req.method === 'PUT') {
            const data = await body(req), source = checkRevision(doc,data.revision), bytes = bytesFor(doc,data.markdown);
            if (!bytes.equals(source.bytes)) writeOriginal(doc.sourcePath,bytes,source);
            const updated = sourceDocument(doc.sourcePath);
            Object.assign(doc,sourceFields(updated),{revision:doc.revision+1,updatedAt:updated.modified});
            return json(res,200,publicDocument(doc));
          }
        }
        return json(res,404,{error:'요청을 찾을 수 없습니다.'});
      }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
    const names = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/markdown.js': 'markdown.js', '/icon.svg': 'icon.svg' };
    const file = names[url.pathname];
    if (!file) { res.writeHead(404); return res.end('Not found'); }
    const mime = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml' }[file.split('.').pop()];
    res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" });
    res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(path.join(ROOT, 'public', file)));

    } catch (err) {
      if (!err.status) console.error(err);
      if (!res.headersSent) json(res,err.status || 500,{error:err.status ? err.message : '파일에 저장하지 못했습니다. 파일 권한과 디스크 공간을 확인해주세요.'});
      else res.end();
    }
  });
  return server;
}
module.exports = {createServer};
if (require.main === module) {
  const port = Number(process.env.LEAFNOTE_PORT || 43127), server = createServer();
  server.on('error',err=>{console.error(err.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`Leafnote: http://127.0.0.1:${port}`));
}
