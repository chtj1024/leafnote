$ErrorActionPreference = 'Stop'
$leafCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $leafCompiler)) { $leafCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
& $leafCompiler /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll (('/reference:' + (Join-Path $PSScriptRoot 'Microsoft.Web.WebView2.Core.dll'))) (('/reference:' + (Join-Path $PSScriptRoot 'Microsoft.Web.WebView2.WinForms.dll'))) (('/win32icon:' + (Join-Path $PSScriptRoot 'Leafnote.ico'))) (('/out:' + (Join-Path $PSScriptRoot 'Leafnote.exe'))) (Join-Path $PSScriptRoot 'LeafnoteLauncher.cs') (Join-Path $PSScriptRoot 'LeafnoteWindow.cs') (Join-Path $PSScriptRoot 'LeafnoteHost.cs') (Join-Path $PSScriptRoot 'LeafnoteApp.cs')
if ($LASTEXITCODE -ne 0) { throw 'Leafnote launcher compilation failed.' }
