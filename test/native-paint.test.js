'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);
test('the first visible native window already has its document and dark frames on cold and warm opens',{skip:process.platform!=='win32'||process.env.LEAFNOTE_NATIVE_UI_TESTS!=='1'},async t=>{
  const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'leafnote-paint-')),binary=path.join(dir,'FirstPaintTests.exe');
  const server=require('./paint-fixture.cjs').paintFixture(root);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));try{fs.rmSync(dir,{recursive:true,force:true});}catch{}});
  for(const file of ['Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll'])fs.copyFileSync(path.join(root,file),path.join(dir,file));
  await run(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:exe','/platform:x64','/main:FirstPaintTests','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/reference:'+path.join(root,'Microsoft.Web.WebView2.Core.dll'),'/reference:'+path.join(root,'Microsoft.Web.WebView2.WinForms.dll'),'/out:'+binary,...['LeafnoteHost.cs','LeafnoteApp.cs','LeafnoteWindow.cs','LeafnoteLauncher.cs','test/FirstPaintTests.cs'].map(file=>path.join(root,file))],{windowsHide:true,timeout:20000});
  await run(binary,['http://127.0.0.1:'+server.address().port,root,dir],{timeout:25000});
  const report=JSON.parse(fs.readFileSync(path.join(dir,'paint-report.json'),'utf8'));assert.equal(report.ok,true,report.error);assert.equal(report.results.length,2);assert.ok(report.results.every(r=>r.allDark));
});
