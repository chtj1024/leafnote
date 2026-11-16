param([Parameter(Mandatory = $true)][string]$Version)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
$stage = Join-Path $dist 'stage'
$package = Join-Path $stage 'Leafnote'
$app = Join-Path $package 'app'
$zip = Join-Path $dist "Leafnote-v$Version-win-x64.zip"

& (Join-Path $root 'build-launcher.ps1')

$index = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
$nodeVersion = ($index | Where-Object { $_.lts -and $_.version -like 'v24.*' } | Select-Object -First 1).version
if (-not $nodeVersion) { throw 'Could not find a Node.js 24 LTS release.' }
$nodeName = "node-$nodeVersion-win-x64"
$cache = Join-Path $dist 'cache'
New-Item -ItemType Directory -Force $cache | Out-Null
$nodeZip = Join-Path $cache "$nodeName.zip"
if (-not (Test-Path -LiteralPath $nodeZip)) { Invoke-WebRequest "https://nodejs.org/dist/$nodeVersion/$nodeName.zip" -OutFile $nodeZip -UseBasicParsing }
$sums = (Invoke-WebRequest "https://nodejs.org/dist/$nodeVersion/SHASUMS256.txt" -UseBasicParsing).Content -split "`n"
$expected = (($sums | Where-Object { $_ -match ([regex]::Escape("$nodeName.zip") + '\s*$') }) -split '\s+')[0]
if ((Get-FileHash $nodeZip -Algorithm SHA256).Hash.ToLower() -ne $expected) { Remove-Item $nodeZip; throw 'Node.js download failed its SHA-256 check.' }

Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $app 'public'), (Join-Path $app 'runtime') | Out-Null
foreach ($file in 'Leafnote.exe','Leafnote.ico','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll','server.js','server-runner.cjs','package.json','file-picker.ps1','stop.cmd','stop.ps1','register-md.cmd','unregister-md.cmd','README.md','LICENSE','THIRD_PARTY_NOTICES.md') {
    Copy-Item (Join-Path $root $file) $app
}
Copy-Item (Join-Path $root 'public\*') (Join-Path $app 'public')

$extract = Join-Path $cache $nodeName
Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $nodeZip $cache -Force
Copy-Item (Join-Path $extract 'node.exe') (Join-Path $app 'runtime\node.exe')
Copy-Item (Join-Path $extract 'LICENSE') (Join-Path $app 'runtime\NODE_LICENSE.txt')

# The only file users need to see: a tiny launcher that starts app\Leafnote.exe.
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /codepage:65001 /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll "/win32icon:$(Join-Path $root 'Leafnote.ico')" "/out:$(Join-Path $package 'Leafnote.exe')" (Join-Path $root 'LeafnoteBootstrap.cs')
if ($LASTEXITCODE -ne 0) { throw 'Leafnote bootstrap compilation failed.' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
Remove-Item $zip -ErrorAction SilentlyContinue
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
Remove-Item $stage -Recurse -Force
Write-Host "Created $zip (Node.js $nodeVersion bundled)"
