'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function editor(preferences={},bridge=null){
  const settings=new Map(Object.entries(preferences));
  const elements=new Map();
  function element(){return {value:'',textContent:'',innerHTML:'',hidden:true,style:{setProperty(name,value){this[name]=value;}},dataset:{},classList:{toggle(){},remove(){}},addEventListener(){},querySelectorAll(){return []},append(){},showModal(){this.open=true;},close(){this.open=false;}};}
  const document={documentElement:element(),body:element(),querySelectorAll(){return []},querySelector(){return null},addEventListener(){},getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},createTextNode(textContent){return {textContent}},createElement:element};
  const context=vm.createContext({document,window:{chrome:bridge?{webview:bridge}:undefined,Markdown:require('../public/markdown'),addEventListener(){},history:{replaceState(){}}},crypto,TextEncoder,TextDecoder,localStorage:{getItem(key){return settings.get(key)??null},setItem(key,value){settings.set(key,value)}},setTimeout(){return 0},clearTimeout(){},fetch(){return new Promise(()=>{})},URLSearchParams,location:{search:''}});
  const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  vm.runInContext(source.slice(0,source.lastIndexOf('safe(async()=>{')),context);
  vm.runInContext("active={id:'p',title:'파일.md',revision:1,path:'original.md'};sourceMode=true;dirty=true;",context);
  return {context,elements,settings,bootstrap:source.slice(source.lastIndexOf('safe(async()=>{')),run:code=>vm.runInContext(code,context)};
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

test('editor font size is restored across launches and never changes document contents or save state',()=>{
  const e=editor({'leafnote.fontSize':'20'});
  assert.equal(e.run("document.documentElement.style['--editor-font-size']"),'20px');
  assert.equal(e.elements.get('fontSize').value,'20');
  e.run("dirty=false;generation=0;lastSavedMarkdown='문서 원문';setFontSize(24);");
  assert.equal(e.settings.get('leafnote.fontSize'),'24');
  assert.equal(e.run('dirty'),false);assert.equal(e.run('generation'),0);assert.equal(e.run('lastSavedMarkdown'),'문서 원문');
  const reopened=editor(Object.fromEntries(e.settings));
  assert.equal(reopened.run("document.documentElement.style['--editor-font-size']"),'24px');
});

test('invalid font preferences use the default and cross-window updates do not write back',()=>{
  for(const value of ['url(https://example.org)','1000','NaN','-1']){
    const e=editor({'leafnote.fontSize':value});
    assert.equal(e.run("document.documentElement.style['--editor-font-size']"),'14px');
    e.run('setFontSize(18,false)');assert.equal(e.settings.get('leafnote.fontSize'),value);
  }
});

test('the editor refuses legacy save servers before opening an editable document',async()=>{
  const e=editor();e.run("active=null;api=async()=>({token:'test',mode:'files'});");
  await e.run(e.bootstrap);
  assert.equal(e.run('active'),null);
  assert.match(e.elements.get('loading').textContent,/stop.cmd/);
  assert.equal(e.elements.get('documentScroll')?.hidden ?? true,true);
});

test('the editor opens normally when the server confirms in-place saves',async()=>{
  const e=editor();e.run("active=null;api=async()=>({token:'test',mode:'files',saveMode:'inplace'});");
  await e.run(e.bootstrap);
  assert.equal(e.run('active.title'),'제목 없는 문서');
  assert.equal(e.elements.get('documentScroll').hidden,false);
});

test('a final table always has one editable paragraph without rewriting an untouched file',async()=>{
  const e=editor();
  e.context.original='| 이름 | 내용 |\r\n| --- | --- |\r\n| 가 | 나 |\r\n';
  e.run("installDocument({id:'table',title:'표.md',path:'table.md',revision:1,markdown:original});");
  assert.equal(e.run('blocks.length'),2);
  assert.equal(e.run('blocks.at(-1).type'),'paragraph');
  assert.match(e.elements.get('editor').innerHTML,/class="block paragraph"/);
  e.run('renderBlocks();renderBlocks();');
  assert.equal(e.run('blocks.length'),2);
  const sent=[];e.context.capture=data=>{sent.push(data);return {id:'table',revision:2};};
  e.run("dirty=true;api=async(url,method,data)=>capture(data);");
  await e.run('flush()');
  assert.equal(sent.length,0);assert.equal(e.run('lastSavedMarkdown'),e.context.original);
  e.run("blocks.at(-1).text='표 아래 새 문장';changed();");
  await e.run('flush()');
  assert.equal(sent.length,1);assert.match(sent[0].markdown,/\| 가 \| 나 \|\n\n표 아래 새 문장/);
});

test('rendering a newly inserted or moved final table adds an editable paragraph',()=>{
  const e=editor();
  e.run("sourceMode=false;blocks=[fresh({type:'table',text:'',rows:[['제목'],['내용']],aligns:[null]})];renderBlocks();");
  assert.equal(e.run('blocks.length'),2);assert.equal(e.run('blocks.at(-1).type'),'paragraph');
});

test('leaving a final table focuses its blank paragraph without adding extra blocks or changes',()=>{
  const e=editor();
  e.run(String.raw`sourceMode=false;blocks=fromMarkdown('| 제목 |\n| --- |\n| 내용 |');dirty=false;focusBlock=id=>{window.focused=id;};leaveTable(blocks[0]);leaveTable(blocks[0]);`);
  assert.equal(e.run('blocks.length'),2);assert.equal(e.run('window.focused'),e.run('blocks[1].id'));assert.equal(e.run('dirty'),false);
});

test('ArrowDown from the end of the last table row moves to the paragraph and Enter still adds rows',()=>{
  const e=editor();
  e.run(String.raw`sourceMode=false;blocks=fromMarkdown('| 제목 |\n| --- |\n| 내용 |');syncBlocks=()=>{};focusBlock=id=>{window.focused=id;};focusTableCell=()=>{};selectionAtEnd=()=>true;getSelection=()=>({rangeCount:1,isCollapsed:true,anchorNode:{}});window.prevented=0;dirty=false;`);
  e.run("tableKeydown({key:'ArrowDown',preventDefault(){window.prevented++;}},blocks[0],{dataset:{row:'1',col:'0'},contains:()=>true});");
  assert.equal(e.run('window.focused'),e.run('blocks[1].id'));assert.equal(e.run('dirty'),false);assert.equal(e.run('window.prevented'),1);
  e.run("tableKeydown({key:'Enter',preventDefault(){}},blocks[0],{dataset:{row:'1',col:'0'}});");
  assert.equal(e.run('blocks[0].rows.length'),3);assert.equal(e.run('blocks.length'),2);assert.equal(e.run('dirty'),true);
});

function tableNavigation() {
  const e=editor(),moves=[];
  e.context.recordMove=(...args)=>moves.push(args);
  e.run(`sourceMode=false;dirty=false;generation=0;
    blocks=[fresh({type:'paragraph',text:'표 위'}),fresh({type:'table',text:'',rows:[['가','나','다'],['라','마','바'],['사','아','자']],aligns:[null,null,null]}),fresh({type:'paragraph',text:''})];
    window.anchor={};window.selection={rangeCount:1,isCollapsed:true,anchorNode:window.anchor};
    getSelection=()=>window.selection;
    window.cell={dataset:{row:'1',col:'1'},contains:node=>node===window.anchor};
    window.atStart=false;window.atEnd=false;window.prevented=0;
    selectionAtStart=()=>window.atStart;selectionAtEnd=()=>window.atEnd;
    syncBlocks=()=>{};focusTableCell=(id,row,col,end)=>recordMove('cell',row,col,!!end);
    focusBlock=(id,end)=>recordMove('block',id,!!end);`);
  return {...e,moves,press(key,options={}){
    e.context.keyEvent={key,...options,preventDefault(){e.run('window.prevented++');}};
    e.run('tableKeydown(keyEvent,blocks[1],window.cell)');
  }};
}

test('vertical arrows move between rows in the same column even within cell text',()=>{
  const e=tableNavigation(),before=e.run('JSON.stringify(blocks)');
  e.press('ArrowUp');e.press('ArrowDown');
  assert.deepEqual(e.moves,[['cell',0,1,true],['cell',2,1,false]]);
  assert.equal(e.run('window.prevented'),2);assert.equal(e.run('JSON.stringify(blocks)'),before);
  assert.equal(e.run('dirty'),false);assert.equal(e.run('generation'),0);
});

test('horizontal arrows edit text internally and cross cells only at text boundaries',()=>{
  const e=tableNavigation();
  e.press('ArrowLeft');e.press('ArrowRight');
  assert.deepEqual(e.moves,[]);assert.equal(e.run('window.prevented'),0);
  e.run('window.atStart=true');e.press('ArrowLeft');
  e.run('window.atEnd=true');e.press('ArrowRight');
  assert.deepEqual(e.moves,[['cell',1,0,true],['cell',1,2,false]]);
  assert.equal(e.run('dirty'),false);
});

test('empty cells support all four arrow directions without creating rows',()=>{
  const e=tableNavigation();
  e.run("blocks[1].rows[1][1]='';window.atStart=true;window.atEnd=true;");
  for(const key of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'])e.press(key);
  assert.deepEqual(e.moves,[['cell',1,0,true],['cell',1,2,false],['cell',0,1,true],['cell',2,1,false]]);
  assert.equal(e.run('blocks[1].rows.length'),3);assert.equal(e.run('dirty'),false);
});

test('table edges do not wrap or create rows and vertical arrows can exit the table',()=>{
  const e=tableNavigation(),before=e.run('JSON.stringify(blocks)');
  e.run("window.cell.dataset.col='0';window.atStart=true;");e.press('ArrowLeft');
  e.run("window.cell.dataset.col='2';window.atEnd=true;");e.press('ArrowRight');
  assert.deepEqual(e.moves,[]);
  e.run("window.cell.dataset.row='0';");e.press('ArrowUp');
  e.run("window.cell.dataset.row='2';");e.press('ArrowDown');
  assert.deepEqual(e.moves,[['block',e.run('blocks[0].id'),true],['block',e.run('blocks[2].id'),false]]);
  assert.equal(e.run('JSON.stringify(blocks)'),before);assert.equal(e.run('dirty'),false);
});

test('selection shortcuts, non-collapsed selections and Korean composition stay inside the cell',()=>{
  const e=tableNavigation();e.run('window.atStart=true;window.atEnd=true;');
  for(const key of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown']){
    for(const modifier of ['shiftKey','ctrlKey','metaKey','altKey'])e.press(key,{[modifier]:true});
    e.press(key,{isComposing:true});e.press(key,{keyCode:229});
    e.run('window.selection.isCollapsed=false');e.press(key);e.run('window.selection.isCollapsed=true');
    e.run('window.selection.anchorNode={}');e.press(key);e.run('window.selection.anchorNode=window.anchor');
    e.run('window.selection.rangeCount=0');e.press(key);e.run('window.selection.rangeCount=1');
  }
  assert.deepEqual(e.moves,[]);assert.equal(e.run('window.prevented'),0);assert.equal(e.run('dirty'),false);
});

test('Backspace and Delete in an empty table row remove only that row',()=>{
  for(const key of ['Backspace','Delete']){
    const e=tableNavigation();
    e.run("blocks[1].rows[1]=['','',''];");
    e.press(key);
    assert.deepEqual(e.run('JSON.stringify(blocks[1].rows)'),JSON.stringify([['가','나','다'],['사','아','자']]));
    assert.equal(e.run('window.prevented'),1);assert.equal(e.run('dirty'),true);
    assert.deepEqual(e.moves.at(-1),key==='Backspace'?['cell',0,1,true]:['cell',1,1,false]);
  }
});

test('Backspace and Delete keep rows that contain text, selections, or are the last row',()=>{
  const e=tableNavigation(),before=e.run('JSON.stringify(blocks)');
  e.run("blocks[1].rows[1]=['','x',''];");
  const withText=e.run('JSON.stringify(blocks)');
  e.press('Backspace');e.press('Delete');
  assert.equal(e.run('JSON.stringify(blocks)'),withText);assert.equal(e.run('window.prevented'),0);
  e.run("blocks[1].rows[1]=['','',''];window.selection.isCollapsed=false;");
  e.press('Backspace');assert.equal(e.run('blocks[1].rows.length'),3);assert.equal(e.run('window.prevented'),0);
  e.run("window.selection.isCollapsed=true;blocks[1].rows=[['','x']];window.cell.dataset.row='0';");
  e.press('Delete');assert.equal(e.run('blocks[1].rows.length'),1);assert.equal(e.run('dirty'),false);
  assert.notEqual(before,withText);
});

test('Backspace and Delete in an empty header-only table remove the whole table',()=>{
  for(const key of ['Backspace','Delete']){
    const e=tableNavigation();
    e.run("blocks[1].rows=[['','','']];window.cell.dataset.row='0';recordHistory=()=>{};closePopups=()=>{};toast=()=>{};renderBlocks=()=>{};changed=()=>{};");
    e.press(key);
    assert.equal(e.run('blocks.some(b=>b.type==="table")'),false);assert.equal(e.run('blocks.length'),2);
    assert.equal(e.run('window.prevented'),1);
  }
});

function nativeEditor(){
  let listener;const replies=[];
  const e=editor({}, {addEventListener(type,handler){if(type==='message')listener=handler;},postMessage(value){replies.push(value);}});
  replies.length=0;
  return {...e,replies,close:()=>listener({data:'leafnote-close'}),message:data=>listener({data})};
}
test('native window close waits for saving before granting permission to close',async()=>{
  const e=nativeEditor(),saved=[];
  e.context.capture=data=>{saved.push(data);return {revision:2};};
  e.run("$('source').value='닫기 전 저장';api=async(url,method,data)=>capture(data);");
  await e.close();
  assert.equal(saved[0].markdown,'닫기 전 저장');assert.equal(e.run('dirty'),false);
  assert.deepEqual(e.replies,['leafnote-close-ok']);
});
test('cancelling native window close keeps an unsaved draft and its text',async()=>{
  const e=nativeEditor();e.run("active.id=null;$('source').value='보관할 초안';");
  const closing=e.close();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(e.elements.get('unsavedDialog').open,true);assert.deepEqual(e.replies,[]);
  e.run("leaveChoice('cancel')");await closing;
  assert.deepEqual(e.replies,['leafnote-close-cancel']);assert.equal(e.run('dirty'),true);
  assert.equal(e.run("$('source').value"),'보관할 초안');
});
test('failed saves and cancelling close leave the original edits available in the native window',async()=>{
  const e=nativeEditor();e.run("$('source').value='저장 실패해도 보관';api=async()=>{throw Error('save failed')};");
  const closing=e.close();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(e.elements.get('unsavedDialog').open,true);
  e.run("leaveChoice('cancel')");await closing;
  assert.deepEqual(e.replies,['leafnote-close-cancel']);assert.equal(e.run('dirty'),true);
  assert.equal(e.run("$('source').value"),'저장 실패해도 보관');
});

test('the native loading theme tracks remembered preferences and theme changes without changing the document',()=>{
  const messages=[];
  const e=editor({'leafnote.dark':'1'},{addEventListener(){},postMessage:value=>messages.push(value)});
  assert.deepEqual(messages,['leafnote-theme:dark']);
  assert.equal(e.run('document.documentElement.dataset.theme'),'dark');
  e.run('dirty=false;generation=0;setTheme(false);');
  assert.deepEqual(messages,['leafnote-theme:dark','leafnote-theme:light']);
  assert.equal(e.settings.get('leafnote.dark'),'0');assert.equal(e.run('dirty'),false);assert.equal(e.run('generation'),0);
  assert.equal(e.run('document.documentElement.dataset.theme'),'light');
});

test('discarding changes before parking the native editor cannot trigger a later autosave',async()=>{
  const e=nativeEditor();e.run("$('source').value='버린 내용';api=async()=>{throw Error('save failed')};");
  const closing=e.close();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(e.elements.get('unsavedDialog').open,true);
  e.run("leaveChoice('discard')");await closing;
  assert.deepEqual(e.replies,['leafnote-close-ok']);assert.equal(e.run('dirty'),false);
});

test('the hidden native host is notified after installing the document without waiting for animation frames',async()=>{
  const e=nativeEditor();
  e.context.requestAnimationFrame=()=>{throw Error('Animation frames are suspended while the native window is hidden');};
  e.run("api=async()=>({token:'test',mode:'files',saveMode:'inplace'});");
  await e.run(e.bootstrap);
  assert.deepEqual(e.replies,['leafnote-ready']);assert.equal(e.run('active.title'),'제목 없는 문서');
});

test('startup errors tell the hidden native host to show an error instead of leaving it invisible',async()=>{
  for(const failure of ["api=async()=>{throw Error('startup failed')}","api=async()=>({token:'test',saveMode:'legacy'})"]){
    const e=nativeEditor();e.run('active=null;'+failure);await e.run(e.bootstrap);
    assert.equal(e.run('active'),null);assert.equal(e.replies.length,1);assert.match(e.replies[0],/^leafnote-open-error:/);
  }
});

test('the native pre-parse theme works before the root exists and handles unavailable storage',()=>{
  const early=fs.readFileSync(path.join(__dirname,'../public/theme.js'),'utf8');
  for(const [saved,expected] of [['1','dark'],['0','light'],[null,'light']]){
    for(const rootExists of [true,false]){
      const root={dataset:{}},document={documentElement:rootExists?root:null};let callback,disconnected=false;
      vm.runInNewContext(early,{document,localStorage:{getItem:()=>saved},MutationObserver:class {constructor(fn){callback=fn;}observe(){}disconnect(){disconnected=true;}}});
      if(!rootExists){document.documentElement=root;callback();assert.equal(disconnected,true);}
      assert.equal(root.dataset.theme,expected);
    }
  }
  assert.doesNotThrow(()=>vm.runInNewContext(early,{localStorage:{getItem(){throw Error('unavailable')}},document:{documentElement:{dataset:{}}}}));
});
