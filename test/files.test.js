'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createServer}=require('../server');
async function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'leafnote-files-')),choices=[];
  const server=createServer({pickFile:async()=>{const choice=choices.shift();return typeof choice==='function' ? choice() : choice || null;}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,bootstrap=await (await fetch(base+'/api/bootstrap')).json();
  async function request(route,method='GET',data,headers={}){
    const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json','X-Leafnote-Token':bootstrap.token,...headers},body:data===undefined?undefined:JSON.stringify(data)});
    return {status:response.status,value:await response.json()};
  }
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
  const file=(name='한글 & %.md',body='처음\r\n')=>{const target=path.join(dir,name);fs.writeFileSync(target,body);return target;};
  return {dir,choices,request,file,bootstrap};
}
test('file-only sessions never create a page index or content cache',async t=>{
  const e=await setup(t),root=path.resolve(__dirname,'..'),before=fs.readdirSync(root);
  assert.deepEqual(Object.keys(e.bootstrap).sort(),['mode','token']);assert.equal(e.bootstrap.mode,'files');
  const file=e.file(),opened=await e.request('/api/open-file','POST',{path:file}),doc=opened.value;
  assert.equal(opened.status,200);assert.equal(doc.path,file);assert.equal(doc.markdown,'처음\r\n');
  const again=await e.request('/api/open-file','POST',{path:path.join(e.dir,'.',path.basename(file))});assert.equal(again.value.id,doc.id);
  assert.equal((await e.request('/api/documents/'+doc.id,'PUT',{revision:doc.revision,markdown:'수정\n'})).status,200);
  assert.equal(fs.readFileSync(file,'utf8'),'수정\r\n');assert.deepEqual(fs.readdirSync(e.dir),[path.basename(file)]);assert.deepEqual(fs.readdirSync(root),before);
  for(const route of ['/api/pages','/api/pages/'+doc.id])assert.equal((await e.request(route,'POST',{})).status,404);
  const fresh=createServer();await new Promise(resolve=>fresh.listen(0,'127.0.0.1',resolve));
  try{assert.equal((await fetch('http://127.0.0.1:'+fresh.address().port+'/api/documents/'+doc.id)).status,404);}finally{fresh.closeAllConnections();await new Promise(resolve=>fresh.close(resolve));}
});
test('original saves preserve UTF8 BOM, UTF16 byte order, BOM and line endings',async t=>{
  const e=await setup(t);
  for(const encoding of ['utf8','utf16le','utf16be']){
    let bytes=Buffer.from('안녕\r\n',encoding==='utf8'?'utf8':'utf16le');if(encoding==='utf16be')bytes.swap16();
    const bom=Buffer.from(encoding==='utf8'?[239,187,191]:encoding==='utf16le'?[255,254]:[254,255]);
    const file=e.file(encoding+'.md',Buffer.concat([bom,bytes]));const doc=(await e.request('/api/open-file','POST',{path:file})).value;
    assert.equal(doc.markdown,'안녕\r\n');assert.equal((await e.request('/api/documents/'+doc.id,'PUT',{revision:doc.revision,markdown:'다음\n'})).status,200);
    let expected=Buffer.from('다음\r\n',encoding==='utf8'?'utf8':'utf16le');if(encoding==='utf16be')expected.swap16();assert.deepEqual(fs.readFileSync(file),Buffer.concat([bom,expected]));
  }
});
test('stale windows, external edits and missing originals cannot be overwritten',async t=>{
  const e=await setup(t),file=e.file(),doc=(await e.request('/api/open-file','POST',{path:file})).value;
  const route='/api/documents/'+doc.id;
  assert.equal((await e.request(route,'PUT',{revision:1,markdown:'one'})).status,200);
  assert.equal((await e.request(route,'PUT',{revision:1,markdown:'stale'})).status,409);
  fs.writeFileSync(file,'외부 수정');assert.equal((await e.request(route,'PUT',{revision:2,markdown:'lost'})).status,409);assert.equal(fs.readFileSync(file,'utf8'),'외부 수정');
  const refreshed=(await e.request(route)).value;assert.equal(refreshed.revision,3);assert.equal(refreshed.markdown,'외부 수정');
  fs.unlinkSync(file);assert.equal((await e.request(route,'PUT',{revision:3,markdown:'recreate'})).status,404);assert.equal(fs.existsSync(file),false);
});
test('request protections remain active',async t=>{
  const e=await setup(t),file=e.file();
  assert.equal((await e.request('/api/open-file','POST',{path:file},{'X-Leafnote-Token':'wrong'})).status,403);
  assert.equal((await e.request('/api/open-file','POST',{path:file},{Origin:'https://example.com'})).status,403);
  const http=require('node:http');
  const health=await e.request('/api/health');
  const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  try {
    const status=await new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port:probe.address().port,path:'/api/health',headers:{Host:'evil.test'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});
    assert.equal(status,403);assert.equal(health.value.version,3);
  } finally {probe.closeAllConnections();await new Promise(resolve=>probe.close(resolve));}
  assert.equal((await e.request('/api/open-file','POST',{path:'relative.md'})).status,400);
});

test('repeated saves keep file identity, creation time and hard links, with no temporary files',async t=>{
  const e=await setup(t),file=e.file('위치 유지.md','원래 내용이 긴 문서입니다.\n');
  const before=fs.statSync(file,{bigint:true}),link=path.join(e.dir,'hardlink.md');
  fs.linkSync(file,link);
  let doc=(await e.request('/api/open-file','POST',{path:file})).value;
  for(const markdown of ['짧게','길어진 내용\n'.repeat(200),'','마지막 내용']){
    const saved=await e.request('/api/documents/'+doc.id,'PUT',{revision:doc.revision,markdown});
    assert.equal(saved.status,200);doc=saved.value;
    const after=fs.statSync(file,{bigint:true});
    assert.equal(after.ino,before.ino);assert.equal(after.birthtimeNs,before.birthtimeNs);
    assert.equal(fs.readFileSync(link,'utf8'),markdown);
    assert.deepEqual(fs.readdirSync(e.dir).sort(),['hardlink.md','위치 유지.md'].sort());
  }
});

test('picker open, cancellation, SaveAs and same-path saves use original files',async t=>{
  const e=await setup(t),file=e.file('선택.md');
  e.choices.push(null);assert.equal((await e.request('/api/choose-open','POST',{})).value.cancelled,true);
  e.choices.push(file);let doc=(await e.request('/api/choose-open','POST',{})).value;
  const before=fs.statSync(file,{bigint:true});
  e.choices.push(file);
  let result=await e.request('/api/save-as','POST',{id:doc.id,revision:doc.revision,markdown:'같은 파일\n'});
  assert.equal(result.status,200);doc=result.value;
  assert.equal(fs.statSync(file,{bigint:true}).ino,before.ino);
  assert.equal(fs.readFileSync(file,'utf8'),'같은 파일\r\n');
  e.choices.push(null);assert.equal((await e.request('/api/save-as','POST',{markdown:'취소'})).value.cancelled,true);
  const newFile=path.join(e.dir,'새 파일.md');e.choices.push(newFile);
  result=await e.request('/api/save-as','POST',{id:doc.id,revision:doc.revision,markdown:'새 파일 내용\n'});
  assert.equal(result.status,200);assert.equal(result.value.path,newFile);
  assert.equal(fs.readFileSync(newFile,'utf8'),'새 파일 내용\r\n');
  e.choices.push(()=>{fs.writeFileSync(file,'외부 수정');return file;});
  assert.equal((await e.request('/api/save-as','POST',{id:doc.id,revision:doc.revision,markdown:'덮어쓰기'})).status,409);
  assert.equal(fs.readFileSync(file,'utf8'),'외부 수정');
});

test('recoverable write errors restore the original bytes and preserve the session',async t=>{
  const e=await setup(t),file=e.file('복구.md','원래 내용'),doc=(await e.request('/api/open-file','POST',{path:file})).value;
  const write=fs.writeSync;
  let fail=true;
  fs.writeSync=function(fd,buffer,offset,length,position){
    if(fail){fail=false;write.call(fs,fd,buffer,offset,Math.min(2,length),position);throw new Error('simulated write failure');}
    return write.apply(fs,arguments);
  };
  try{assert.equal((await e.request('/api/documents/'+doc.id,'PUT',{revision:doc.revision,markdown:'실패할 변경'})).status,500);}
  finally{fs.writeSync=write;}
  assert.equal(fs.readFileSync(file,'utf8'),'원래 내용');
  assert.equal((await e.request('/api/documents/'+doc.id,'PUT',{revision:doc.revision,markdown:'재시도'})).status,200);
});
