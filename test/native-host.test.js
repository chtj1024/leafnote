'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);
test('native WebView editor owns its first window and protects document closing',{skip:process.platform!=='win32'||process.env.LEAFNOTE_NATIVE_UI_TESTS!=='1'},async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'leafnote-native-')),root=path.resolve(__dirname,'..');
  const page=`<!doctype html><title>Native editor test · Leafnote</title><p>편집기 로드 확인</p><script>
    let closes=0;
    chrome.webview.addEventListener('message',e=>{if(e.data==='leafnote-close')chrome.webview.postMessage(++closes===1?'leafnote-close-cancel':'leafnote-close-ok');});
    addEventListener('load',()=>setTimeout(()=>{chrome.webview.postMessage('leafnote-ready');chrome.webview.postMessage('probe-ready');},200));
  </script>`;
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));try{fs.rmSync(directory,{recursive:true,force:true});}catch{ /* The WebView runtime can finish releasing its profile after the host exits. */ }});
  const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe'),binary=path.join(directory,'NativeHostTests.exe');
  for(const file of ['Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll'])fs.copyFileSync(path.join(root,file),path.join(directory,file));
  await run(compiler,['/nologo','/target:exe','/main:NativeHostTests','/platform:x64','/optimize+','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/reference:'+path.join(root,'Microsoft.Web.WebView2.Core.dll'),'/reference:'+path.join(root,'Microsoft.Web.WebView2.WinForms.dll'),'/out:'+binary,path.join(root,'LeafnoteWindow.cs'),path.join(root,'LeafnoteHost.cs'),path.join(root,'LeafnoteApp.cs'),path.join(root,'LeafnoteLauncher.cs'),path.join(__dirname,'NativeHostTests.cs')],{windowsHide:true,timeout:20000});
  for(const scenario of process.env.LEAFNOTE_HOST_SCENARIOS?.split(',') || ['normal','maximized','default'])await t.test(scenario,async()=>{
    const state=path.join(directory,scenario);fs.mkdirSync(state);
    const child=execFile(binary,[scenario,'http://127.0.0.1:'+server.address().port,root,state],{windowsHide:false,timeout:30000});
    let output='';child.stdout.on('data',chunk=>{output+=chunk;process.stdout.write(chunk);});
    child.stderr.on('data',chunk=>process.stderr.write(chunk));
    await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(new Error('Native host exit '+code+' '+signal+'; '+output)));});
    const result={stdout:output};
    assert.match(result.stdout,/first visible frame preserved/);
  });
});
