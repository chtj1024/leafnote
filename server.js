'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
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
const MAX_IMAGE = 20 * 1024 * 1024, MAX_IMAGE_BODY = Math.ceil(MAX_IMAGE * 4 / 3) + 4096;
const IMAGE_TYPES = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.bmp':'image/bmp'};
function sniffImage(b) {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return '.png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
  if (b.toString('latin1',0,4) === 'GIF8') return '.gif';
  if (b.toString('latin1',0,4) === 'RIFF' && b.toString('latin1',8,12) === 'WEBP') return '.webp';
  if (b[0] === 0x42 && b[1] === 0x4d) return '.bmp';
  return null;
}
const insideDirectory = (directory, file) => {
  const relative = path.relative(directory, file);
  return !!relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
// Resolve a relative image path from the document, never leaving its folder.
function imageFile(doc, src) {
  let relative = String(src || '');
  try { relative = decodeURIComponent(relative); } catch {}
  const type = IMAGE_TYPES[path.extname(relative).toLowerCase()];
  if (!type || relative.includes('\0') || path.isAbsolute(relative) || /^[\\/]/.test(relative)) throw problem('이미지 경로가 올바르지 않습니다.');
  let file, stat;
  try {
    const base = fs.realpathSync(path.dirname(doc.sourcePath));
    file = fs.realpathSync(path.resolve(base,relative));
    if (!insideDirectory(base,file)) throw problem('문서 폴더 안의 이미지만 사용할 수 있습니다.',403);
    stat = fs.statSync(file);
  } catch (err) {
    if (err.status) throw err;
    throw problem('이미지 파일을 찾을 수 없습니다.',404);
  }
  if (!stat.isFile()) throw problem('이미지 파일을 찾을 수 없습니다.',404);
  if (stat.size > MAX_IMAGE) throw problem('이미지는 20MB까지 사용할 수 있습니다.',413);
  return {file,type,size:stat.size};
}
const markdownPath = value => value.replace(/[%\s()#?<>"\\]/g, c => c === '(' ? '%28' : c === ')' ? '%29' : encodeURIComponent(c));
function saveImage(doc, bytes) {
  const extension = sniffImage(bytes);
  if (!extension) throw problem('PNG, JPEG, GIF, WebP, BMP 이미지만 붙여넣을 수 있습니다.',415);
  const folder = path.basename(doc.sourcePath).replace(/\.(md|markdown)$/i,'') + '.assets';
  const directory = path.join(path.dirname(doc.sourcePath),folder);
  try {
    fs.mkdirSync(directory,{recursive:true});
    if (!fs.lstatSync(directory).isDirectory()) throw new Error('not a directory');
  } catch { throw problem('이미지를 저장할 폴더를 만들 수 없습니다. 같은 이름의 파일이 있는지 확인해주세요.',403); }
  const now = new Date(), pad = n => String(n).padStart(2,'0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const name = `image-${stamp}-${crypto.randomBytes(2).toString('hex')}${extension}`;
    try { fs.writeFileSync(path.join(directory,name),bytes,{flag:'wx'}); }
    catch (err) { if (err.code === 'EEXIST') continue; throw err; }
    return {name,src:markdownPath(folder) + '/' + name};
  }
  throw problem('이미지를 저장하지 못했습니다. 다시 시도해주세요.',500);
}
const {renderHtml,printPdf} = require('./pdf');
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function body(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > limit) { reject(Object.assign(new Error(limit === MAX_BODY ? '문서는 5MB까지 저장할 수 있습니다.' : '이미지는 20MB까지 붙여넣을 수 있습니다.'), { status: 413 })); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('올바르지 않은 요청입니다.'), { status: 400 })); } });
    req.on('error', reject);
  });
}

function createServer({pickFile = chooseFile, makePdf = printPdf} = {}) {
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
        if (url.pathname === '/api/health' && req.method === 'GET') return json(res,200,{app:'leafnote',version:3,mode:'files',saveMode:'inplace',build:'file-editor-inplace-3',root:ROOT});
        if (url.pathname === '/api/bootstrap' && req.method === 'GET') return json(res,200,{token:TOKEN,mode:'files',saveMode:'inplace'});
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
        if (url.pathname === '/api/export-pdf' && req.method === 'POST') {
          const data = await body(req), doc = data.id ? getDocument(data.id) : null;
          if (typeof data.markdown !== 'string') throw problem('내보낼 문서 내용이 필요합니다.');
          const title = doc ? path.basename(doc.sourcePath) : typeof data.title === 'string' && data.title.trim() ? data.title : '제목 없는 문서';
          const name = title.replace(/[\\/:*?"<>|]/g,'_').replace(/\.(md|markdown)$/i,'') + '.pdf';
          const file = await pick({kind:'pdf',name,directory:doc ? path.dirname(doc.sourcePath) : ''});
          if (!file) return json(res,200,{cancelled:true});
          if (!path.isAbsolute(file) || !/\.pdf$/i.test(file)) throw problem('PDF 파일 이름을 선택해주세요.');
          const imageUrl = doc ? src => { try { return pathToFileURL(imageFile(doc,src).file).href; } catch { return null; } } : null;
          await makePdf(renderHtml(data.markdown,{imageUrl,title}),file);
          return json(res,200,{path:file});
        }
        const imageMatch = url.pathname.match(/^\/api\/documents\/([a-f0-9-]{36})\/image(s?)$/);
        if (imageMatch) {
          const doc = getDocument(imageMatch[1]);
          if (imageMatch[2] && req.method === 'POST') {
            const data = await body(req,MAX_IMAGE_BODY);
            if (typeof data.data !== 'string') throw problem('붙여넣을 이미지가 필요합니다.');
            const bytes = Buffer.from(data.data,'base64');
            if (bytes.length > MAX_IMAGE) throw problem('이미지는 20MB까지 붙여넣을 수 있습니다.',413);
            return json(res,200,saveImage(doc,bytes));
          }
          if (!imageMatch[2] && (req.method === 'GET' || req.method === 'HEAD')) {
            const image = imageFile(doc,url.searchParams.get('src'));
            res.writeHead(200,{'Content-Type':image.type,'Content-Length':image.size,'Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});
            if (req.method === 'HEAD') return res.end();
            const stream = fs.createReadStream(image.file);
            stream.on('error',() => res.destroy());
            return stream.pipe(res);
          }
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
