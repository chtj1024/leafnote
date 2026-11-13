param([string]$PathBase64 = '', [switch]$NoBrowser, [int]$Port = 43127)
$ErrorActionPreference = 'Stop'
$leafMutex = $null
$leafLocked = $false
try {
    $leafRoot = $PSScriptRoot
    $leafUrl = "http://127.0.0.1:$Port"
    $leafFile = ''
    if ($PathBase64) {
        $leafFile = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PathBase64))
        if (-not [IO.Path]::IsPathRooted($leafFile) -or -not (Test-Path -LiteralPath $leafFile -PathType Leaf) -or [IO.Path]::GetExtension($leafFile) -notin '.md','.markdown') { throw '기존 .md 또는 .markdown 파일을 선택해주세요.' }
    }
    $leafSha = [Security.Cryptography.SHA256]::Create()
    try { $leafKey = ([BitConverter]::ToString($leafSha.ComputeHash([Text.Encoding]::UTF8.GetBytes($leafRoot.ToLowerInvariant())))).Replace('-','').Substring(0,20) }
    finally { $leafSha.Dispose() }
    $leafMutex = New-Object Threading.Mutex($false, "Local\Leafnote-$leafKey-$Port")
    try { $leafLocked = $leafMutex.WaitOne(30000) } catch [Threading.AbandonedMutexException] { $leafLocked = $true }
    if (-not $leafLocked) { throw 'Leafnote 시작 대기 시간이 초과되었습니다. 잠시 후 다시 열어주세요.' }
    $leafHealth = $null
    try { $leafHealth = Invoke-RestMethod "$leafUrl/api/health" -TimeoutSec 2 } catch {}
    if ($leafHealth) {
        if ($leafHealth.app -ne 'leafnote' -or $leafHealth.root -ne $leafRoot) { throw '다른 프로그램 또는 다른 폴더의 Leafnote가 실행 중입니다. 해당 Leafnote의 stop.cmd 실행 후 다시 열어주세요.' }
        if ($leafHealth.version -lt 3) { throw '이전 Leafnote가 실행 중입니다. 문서의 저장됨 표시를 확인하고 stop.cmd 실행 후 Leafnote.exe를 다시 열어주세요.' }
    } else {
        $leafNode = $null
        $leafCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($leafCommand) { $leafNode = $leafCommand.Source }
        if (-not $leafNode) {
            $leafNode = @((Join-Path $leafRoot 'runtime\node.exe'), (Join-Path $env:ProgramFiles 'nodejs\node.exe'), (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        }
        if (-not $leafNode) { throw 'Node.js 18 이상을 설치한 뒤 다시 열어주세요.' }
        $leafLogs = Join-Path ([IO.Path]::GetTempPath()) ('Leafnote\' + $leafKey)
        New-Item -ItemType Directory -Force -Path $leafLogs | Out-Null
        $env:LEAFNOTE_PORT = [string]$Port
        Start-Process -FilePath $leafNode -ArgumentList ('"' + (Join-Path $leafRoot 'server.js') + '"') -WorkingDirectory $leafRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $leafLogs 'server.log') -RedirectStandardError (Join-Path $leafLogs 'error.log') | Out-Null
        $leafReady = $false
        for ($leafAttempt = 0; $leafAttempt -lt 40; $leafAttempt++) {
            Start-Sleep -Milliseconds 200
            try {
                $leafHealth = Invoke-RestMethod "$leafUrl/api/health" -TimeoutSec 1
                if ($leafHealth.app -eq 'leafnote' -and $leafHealth.root -eq $leafRoot -and $leafHealth.version -ge 3) { $leafReady = $true; break }
            } catch {}
        }
        if (-not $leafReady) { throw 'Leafnote를 시작하지 못했습니다. 임시 폴더의 Leafnote 로그를 확인해주세요.' }
    }
    if ($leafFile) {
        $leafBoot = Invoke-RestMethod "$leafUrl/api/bootstrap" -TimeoutSec 5
        $leafJson = @{path = $leafFile} | ConvertTo-Json -Compress
        $leafPage = Invoke-RestMethod "$leafUrl/api/open-file" -Method Post -ContentType 'application/json; charset=utf-8' -Headers @{'X-Leafnote-Token' = $leafBoot.token} -Body ([Text.Encoding]::UTF8.GetBytes($leafJson)) -TimeoutSec 10
        $leafUrl += '/?document=' + $leafPage.id
    }
    $leafMutex.ReleaseMutex(); $leafLocked = $false
    if ($NoBrowser) { Write-Output $leafUrl; exit 0 }
    $leafEdge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
    if (Test-Path -LiteralPath $leafEdge) { Start-Process -FilePath $leafEdge -ArgumentList "--app=$leafUrl", '--new-window' -WindowStyle Normal }
    else { Start-Process $leafUrl }
} catch {
    if ($NoBrowser) { Write-Error $_; exit 1 }
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Leafnote', 'OK', 'Error') | Out-Null
    exit 1
} finally {
    if ($leafLocked) { $leafMutex.ReleaseMutex() }
    if ($leafMutex) { $leafMutex.Dispose() }
}
