'use strict';
const test=require('node:test'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);
test('Windows window position persistence',{skip:process.platform!=='win32'},async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'leafnote-window-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const compiler=path.join(process.env.WINDIR || 'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  const binary=path.join(directory,'WindowGeometryTests.exe');
  await run(compiler,['/nologo','/target:exe','/optimize+','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/out:'+binary,path.join(__dirname,'../LeafnoteWindow.cs'),path.join(__dirname,'WindowGeometryTests.cs')],{windowsHide:true,timeout:20000});
  const checks={
    roundtrip:'position, size and maximization survive a settings round trip',
    'negative-monitor':'negative coordinates on a second monitor are preserved',
    'removed-monitor':'a disconnected monitor cannot leave the window off screen',
    'small-screen':'smaller displays and top taskbars keep the window visible',
    corrupt:'missing, corrupt and invalid settings fall back safely',
    'last-close':'the last closed window determines the next placement',
    concurrent:'simultaneously closing windows cannot corrupt preferences',
    'root-isolation':'each installation keeps its own window settings',
    native:'native restore preserves bounds and maximization while ignoring minimization',
  };
  for(const [name,label] of Object.entries(checks))await t.test(label,async()=>{
    const stateDirectory=path.join(directory,name);fs.mkdirSync(stateDirectory);
    await run(binary,[name,stateDirectory],{windowsHide:true,timeout:10000});
  });
});
