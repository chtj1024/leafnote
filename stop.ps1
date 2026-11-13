$ErrorActionPreference = 'Stop'
$leafUrl = 'http://127.0.0.1:43127'
try {
    $leafHealth = Invoke-RestMethod "$leafUrl/api/health" -TimeoutSec 2
    if ($leafHealth.app -ne 'leafnote') { throw 'Another application is using this port.' }
    $leafState = Invoke-RestMethod "$leafUrl/api/bootstrap" -TimeoutSec 2
    Invoke-RestMethod "$leafUrl/api/shutdown" -Method Post -ContentType 'application/json' -Headers @{ 'X-Leafnote-Token' = $leafState.token } -Body '{}' -TimeoutSec 2 | Out-Null
    Write-Host 'Leafnote stopped. Open start.cmd to start it again.'
} catch { Write-Host ('Could not stop Leafnote: ' + $_.Exception.Message); exit 1 }
