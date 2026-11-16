'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);
test('native cold startup starts one in-place server without PowerShell',{skip:process.platform!=='win32'},async t=>{
  const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'leafnote-start-')),binary=path.join(dir,'LauncherServerTests.exe');
  const compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  for(const file of ['Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll'])fs.copyFileSync(path.join(root,file),path.join(dir,file));
  await run(compiler,['/nologo','/target:exe','/platform:x64','/main:LauncherServerTests','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/reference:'+path.join(root,'Microsoft.Web.WebView2.Core.dll'),'/reference:'+path.join(root,'Microsoft.Web.WebView2.WinForms.dll'),'/out:'+binary,...['LeafnoteLauncher.cs','LeafnoteHost.cs','LeafnoteApp.cs','LeafnoteWindow.cs','test/LauncherServerTests.cs'].map(file=>path.join(root,file))],{windowsHide:true,timeout:20000});
  const lease=http.createServer();await new Promise(resolve=>lease.listen(0,'127.0.0.1',resolve));const port=lease.address().port;await new Promise(resolve=>lease.close(resolve));
  const base='http://127.0.0.1:'+port;
  t.after(async()=>{try{const boot=await(await fetch(base+'/api/bootstrap')).json();await fetch(base+'/api/shutdown',{method:'POST',headers:{'Content-Type':'application/json','X-Leafnote-Token':boot.token},body:'{}'});}catch{}fs.rmSync(dir,{recursive:true,force:true});});
  const file=path.join(dir,'한글 & 공백.md');fs.writeFileSync(file,'원본 내용\n');const before=fs.statSync(file,{bigint:true});
  const launch=()=>new Promise((resolve,reject)=>{
    const child=execFile(binary,[root,file,String(port)],{windowsHide:true,timeout:12000});let stdout='',stderr='';
    child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
    child.once('error',reject);child.once('exit',code=>code===0?resolve({stdout}):reject(new Error(stderr)));
  });
  const results=await Promise.all([launch(),launch()]);
  const urls=results.map(result=>result.stdout.trim());assert.equal(urls[0],urls[1]);
  const health=await(await fetch(base+'/api/health')).json();assert.equal(health.root,root);assert.equal(health.saveMode,'inplace');
  const document=await(await fetch(urls[0].replace('/?document=','/api/documents/'))).json();assert.equal(document.markdown,'원본 내용\n');
  const after=fs.statSync(file,{bigint:true});assert.equal(after.ino,before.ino);assert.equal(after.mtimeNs,before.mtimeNs);
});
