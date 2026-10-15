param(
    [int]$ApiPort = 8080,
    [int]$WorkerPort = 8081,
    [int]$WebPort = 5173,
    [int]$PartnerPort = 5174,
    [int]$DbPort = 5434,
    [int]$SmtpPort = 3025,
    [int]$Workers = 1,
    [switch]$Rebuild,
    [switch]$LoadUsers
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Find-Java {
    $candidates = @()
    if ($env:JAVA_HOME) { $candidates += $env:JAVA_HOME }
    $onPath = Get-Command java -ErrorAction SilentlyContinue
    if ($onPath) { $candidates += (Split-Path -Parent (Split-Path -Parent $onPath.Source)) }
    foreach ($base in 'C:\Program Files\Java', 'C:\Program Files\Eclipse Adoptium', 'C:\Program Files\Microsoft') {
        if (Test-Path $base) { $candidates += (Get-ChildItem $base -Directory | Sort-Object Name -Descending | ForEach-Object FullName) }
    }
    foreach ($candidate in $candidates) {
        $exe = Join-Path $candidate 'bin\java.exe'
        if (-not (Test-Path $exe)) { continue }
        $version = (cmd /c "`"$exe`" -version 2>&1" | Select-Object -First 1)
        if ($version -match '"(\d+)') {
            if ([int]$Matches[1] -ge 21) { return $candidate }
        }
    }
    throw 'Java 21 or newer was not found. Install a JDK and set JAVA_HOME.'
}

function Wait-For($url, $name, $seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Seconds 2
    }
    throw "$name did not become ready at $url. See logs\."
}

function Start-Logged($file, $arguments, $log, $workdir) {
    $out = Join-Path $root "logs\$log.log"
    $err = Join-Path $root "logs\$log.err.log"
    $process = Start-Process -FilePath $file -ArgumentList $arguments -WorkingDirectory $workdir `
        -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru
    Add-Content -Path (Join-Path $root '.run\pids.txt') -Value $process.Id
    return $process
}

$javaHome = Find-Java
$env:JAVA_HOME = $javaHome
$java = Join-Path $javaHome 'bin\java.exe'
New-Item -ItemType Directory -Force -Path (Join-Path $root 'logs'), (Join-Path $root '.run') | Out-Null
if (Test-Path (Join-Path $root '.run\pids.txt')) { & (Join-Path $PSScriptRoot 'dev-down.ps1') }

$apiJar = Join-Path $root 'api\target\api-1.0.0.jar'
$workerJar = Join-Path $root 'worker\target\worker-1.0.0.jar'
if ($Rebuild -or -not (Test-Path $apiJar) -or -not (Test-Path $workerJar)) {
    Write-Host 'Building services...'
    & (Join-Path $root 'mvnw.cmd') -q -DskipTests package
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
}

$webOrigin = "http://localhost:$WebPort"
$partnerOrigin = "http://localhost:$PartnerPort"
$apiUrl = "http://localhost:$ApiPort"

$env:SERVER_PORT = $ApiPort
$env:TRUSTPASS_DB_PORT = $DbPort
$env:TRUSTPASS_SEED = 'true'
$env:TRUSTPASS_SEED_LOAD_USERS = if ($LoadUsers) { 'true' } else { 'false' }
$env:TRUSTPASS_SECURITY_ISSUER = $apiUrl
$env:TRUSTPASS_FRONTEND_URL = $webOrigin
$env:TRUSTPASS_CORS_ALLOWED_ORIGINS = "$webOrigin,$partnerOrigin"
$env:TRUSTPASS_PARTNER_REDIRECT_URI = "$partnerOrigin/callback"
Write-Host 'Starting API (the first start also initialises the embedded PostgreSQL)...'
Start-Logged $java @('-jar', $apiJar) 'api' $root | Out-Null
Wait-For "$apiUrl/actuator/health" 'The API' 240

for ($i = 0; $i -lt $Workers; $i++) {
    $env:SERVER_PORT = $WorkerPort + $i
    $env:TRUSTPASS_MAIL_SMTP_PORT = $SmtpPort
    $env:TRUSTPASS_MAIL_EMBEDDED = if ($i -eq 0) { 'true' } else { 'false' }
    Write-Host "Starting worker $($i + 1)..."
    Start-Logged $java @('-jar', $workerJar) "worker$($i + 1)" $root | Out-Null
}
Wait-For "http://localhost:$WorkerPort/actuator/health" 'The worker' 120

$env:VITE_API_URL = $apiUrl
$env:VITE_MAIL_URL = "http://localhost:$WorkerPort"
$env:VITE_TRUSTPASS_URL = $apiUrl
$env:WEB_PORT = $WebPort
$env:PARTNER_PORT = $PartnerPort
foreach ($app in 'web', 'partner-demo') {
    $dir = Join-Path $root $app
    if (-not (Test-Path (Join-Path $dir 'node_modules'))) {
        Write-Host "Installing $app dependencies..."
        Push-Location $dir; npm install --no-audit --no-fund | Out-Null; Pop-Location
    }
    $npm = (Get-Command npm.cmd).Source
    Write-Host "Starting $app..."
    Start-Logged $npm @('run', 'dev') $app $dir | Out-Null
}
Wait-For $webOrigin 'The web app' 90
Wait-For $partnerOrigin 'The partner demo' 90

Write-Host ''
Write-Host "Web app:       $webOrigin"
Write-Host "Partner demo:  $partnerOrigin"
Write-Host "API docs:      $apiUrl/swagger-ui.html"
Write-Host "Dev mailbox:   $webOrigin/dev/mailbox"
Write-Host 'Seeded accounts (password TrustPass#2025): admin@, support@, reviewer@, member@trustpass.dev'
Write-Host 'Stop everything with scripts\dev-down.ps1'

