'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function editor(){
  const elements=new Map();
  function element(){return {value:'',textContent:'',innerHTML:'',hidden:true,style:{},dataset:{},classList:{toggle(){},remove(){}},addEventListener(){},querySelectorAll(){return []},append(){}};}
  const document={body:element(),querySelectorAll(){return []},querySelector(){return null},addEventListener(){},getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},createTextNode(textContent){return {textContent}},createElement:element};
  const context=vm.createContext({document,window:{Markdown:require('../public/markdown'),addEventListener(){},history:{replaceState(){}}},crypto,TextEncoder,TextDecoder,localStorage:{getItem(){return null},setItem(){}},setTimeout(){return 0},clearTimeout(){},fetch(){return new Promise(()=>{})},URLSearchParams,location:{search:''}});
  const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  vm.runInContext(source.slice(0,source.lastIndexOf('safe(async()=>{')),context);
  vm.runInContext("active={id:'p',title:'파일.md',revision:1,path:'original.md'};sourceMode=true;dirty=true;",context);
  return {context,elements,run:code=>vm.runInContext(code,context)};
}
test('untouched source including textarea CRLF normalization is never rewritten',async()=>{
  const e=editor();e.context.capture=()=>{throw Error('untouched file must not be written')};
  e.run(String.raw`lastSavedMarkdown='---\r\ntitle: 원문\r\n---\r\n\r\n*  원래 공백\r\n';$('source').value=lastSavedMarkdown.replace(/\r\n/g,'\n');api=async()=>capture();`);
  await e.run('flush()');assert.equal(e.run('dirty'),false);
});
test('edits made during autosave are sent in order and become the saved baseline',async()=>{
  const e=editor(),sent=[];let release;
  e.context.saveRequest=payload=>{sent.push(JSON.parse(JSON.stringify(payload)));if(sent.length===1)return new Promise(resolve=>{release=()=>resolve({id:'p',revision:2})});return Promise.resolve({id:'p',revision:3});};
  e.run("lastSavedMarkdown='처음';$('source').value='첫 번째 변경';api=async(url,method,payload)=>saveRequest(payload);");
  const saving=e.run('flush()');e.run("$('source').value='저장 중 두 번째 변경';changed('typing');");release();await saving;
  assert.deepEqual(sent.map(p=>p.markdown),['첫 번째 변경','저장 중 두 번째 변경']);assert.deepEqual(sent.map(p=>p.revision),[1,2]);
  assert.equal(e.run('lastSavedMarkdown'),'저장 중 두 번째 변경');assert.equal(e.run('dirty'),false);
});
test('draft autosave never opens a chooser and explicit save handles cancellation',async()=>{
  const e=editor(),sent=[];
  e.context.choose=async(url)=>{sent.push(url);return {cancelled:true};};
  e.run("active.id=null;lastSavedMarkdown='';$('source').value='초안';api=choose;");
  await e.run('flush()');assert.deepEqual(sent,[]);assert.equal(e.run('dirty'),true);
  assert.equal(await e.run('save()'),false);assert.deepEqual(sent,['/api/save-as']);assert.equal(e.run('dirty'),true);
});

test('SaveAs preserves edits made while saving a draft',async()=>{
  const e=editor(),sent=[];let release;
  e.context.request=(url,method,payload)=>{sent.push({url,...payload});if(sent.length===1)return new Promise(resolve=>{release=()=>resolve({id:'saved',title:'새 문서.md',path:'new.md',revision:1})});return Promise.resolve({id:'saved',revision:2});};
  e.run("active.id=null;lastSavedMarkdown='';$('source').value='초안';api=request;");
  const promise=e.run('saveAs()');await new Promise(resolve=>setImmediate(resolve));
  e.run("$('source').value='저장 중 수정';changed('typing');");release();await promise;
  assert.deepEqual(sent.map(p=>p.markdown),['초안','저장 중 수정']);
  assert.deepEqual(sent.map(p=>p.url),['/api/save-as','/api/documents/saved']);
  assert.equal(e.run('dirty'),false);assert.equal(e.run('hasFile()'),true);
});

test('cancelling open keeps the current document and accepted files use server sessions',async()=>{
  const e=editor();
  e.run("dirty=false;api=async()=>({cancelled:true});");
  await e.run('openDocument()');assert.equal(e.run('active.id'),'p');
  e.run("api=async()=>({id:'opened',title:'다른 파일.md',path:'other.md',markdown:'본문',revision:1});");
  await e.run('openDocument()');assert.equal(e.run('active.id'),'opened');assert.equal(e.run('hasFile()'),true);
});

test('failed saves keep the current document and dirty state',async()=>{
  const e=editor();e.run("$('source').value='보관할 변경';api=async()=>{throw new Error('conflict')};");
  await assert.rejects(e.run('flush()'),/conflict/);assert.equal(e.run('dirty'),true);assert.equal(e.run("$('source').value"),'보관할 변경');
});
