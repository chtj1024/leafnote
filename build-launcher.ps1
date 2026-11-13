$ErrorActionPreference = 'Stop'
$leafCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $leafCompiler)) { $leafCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
& $leafCompiler /nologo /target:winexe /platform:anycpu /reference:System.Windows.Forms.dll (('/win32icon:' + (Join-Path $PSScriptRoot 'Leafnote.ico'))) (('/out:' + (Join-Path $PSScriptRoot 'Leafnote.exe'))) (Join-Path $PSScriptRoot 'LeafnoteLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Leafnote launcher compilation failed.' }
