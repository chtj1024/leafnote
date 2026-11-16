'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);
test('native startup never shows an empty HWND and immediately erases with the selected background',{skip:process.platform!=='win32'},async t=>{
  const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'leafnote-visibility-')),binary=path.join(dir,'NativeVisibilityTests.exe');
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  for(const file of ['Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll'])fs.copyFileSync(path.join(root,file),path.join(dir,file));
  await run(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:exe','/platform:x64','/main:NativeVisibilityTests','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/reference:'+path.join(root,'Microsoft.Web.WebView2.Core.dll'),'/reference:'+path.join(root,'Microsoft.Web.WebView2.WinForms.dll'),'/out:'+binary,...['LeafnoteHost.cs','LeafnoteApp.cs','LeafnoteWindow.cs','LeafnoteLauncher.cs','test/NativeVisibilityTests.cs'].map(file=>path.join(root,file))],{windowsHide:true,timeout:20000});
  const result=await run(binary,[root,dir],{windowsHide:true,timeout:10000});assert.match(result.stdout,/startup HWNDs hidden; transitions disabled; first native erase dark/);assert.match(result.stdout,/Ctrl\+W closes only the current window and honors cancellation/);
});
