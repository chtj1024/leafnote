'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);

test('native dark loading, close cancellation, empty controller reuse and idle expiry',{skip:process.platform!=='win32'||process.env.LEAFNOTE_NATIVE_UI_TESTS!=='1'},async t=>{
  const root=path.resolve(__dirname,'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'leafnote-speed-')),binary=path.join(directory,'StartupSpeedTests.exe');
  const page=`<!doctype html><html style="background:#20251f;color:#e3e8de"><title>Leafnote startup check</title><p>시작 확인</p><script>
    chrome.webview.addEventListener('message',e=>{if(e.data==='leafnote-close'){chrome.webview.postMessage(globalThis.cancelNext?'leafnote-close-cancel':'leafnote-close-ok');globalThis.cancelNext=false;}});
    chrome.webview.postMessage('leafnote-theme:dark');
    addEventListener('load',()=>setTimeout(()=>{chrome.webview.postMessage('leafnote-ready');chrome.webview.postMessage('probe-ready');},20));
  </script></html>`;
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));try{fs.rmSync(directory,{recursive:true,force:true});}catch{}});
  for(const file of ['Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll'])fs.copyFileSync(path.join(root,file),path.join(directory,file));
  await run(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:exe','/main:StartupSpeedTests','/platform:x64','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/reference:'+path.join(root,'Microsoft.Web.WebView2.Core.dll'),'/reference:'+path.join(root,'Microsoft.Web.WebView2.WinForms.dll'),'/out:'+binary,...['LeafnoteWindow.cs','LeafnoteHost.cs','LeafnoteApp.cs','LeafnoteLauncher.cs','test/StartupSpeedTests.cs'].map(file=>path.join(root,file))],{windowsHide:true,timeout:20000});
  await run(binary,['http://127.0.0.1:'+server.address().port,root,directory],{timeout:25000});
  const report=JSON.parse(fs.readFileSync(path.join(directory,'speed-report.json'),'utf8'));
  assert.equal(report.ok,true,report.error);assert.equal(report.measurements.length,2);assert.equal(report.measurements[1].reused,true);
});
