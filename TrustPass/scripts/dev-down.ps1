$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root '.run\pids.txt'

if (Test-Path $pidFile) {
    foreach ($id in Get-Content $pidFile) {
        if ($id) { & taskkill /PID $id /T /F 2>$null | Out-Null }
    }
    Remove-Item $pidFile -Force
}

$postmaster = Join-Path $root '.data\pg\postmaster.pid'
if (Test-Path $postmaster) {
    $id = (Get-Content $postmaster -TotalCount 1).Trim()
    if ($id) { & taskkill /PID $id /T /F 2>$null | Out-Null }
}
Write-Host 'Stopped.'
