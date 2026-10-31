# One-shot Windows installer: install dependencies, ffmpeg, and yt-dlp.
# Usage (normal PowerShell):
#   powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host '=== Discord YouTube Music Bot installer ===' -ForegroundColor Cyan

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw 'Node.js was not found. Install Node.js 22 LTS or newer from https://nodejs.org and reopen PowerShell.'
}
$major = [int]((node --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) {
    throw "Node.js 22 or newer is required. Found $(node --version)."
}
Write-Host "Node.js $(node --version) found."

if (Test-Path (Join-Path $Root 'package-lock.json')) {
    Write-Host 'Installing npm dependencies...'
    npm ci --no-audit --no-fund
} else {
    npm install --no-audit --no-fund
}
if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }

Write-Host 'Preparing ffmpeg and yt-dlp...'
node scripts/setup.mjs
if ($LASTEXITCODE -ne 0) { throw 'Setup failed.' }

if (-not (Test-Path (Join-Path $Root '.env'))) {
    Copy-Item .env.example .env
    Write-Host 'Created .env. Open it and fill in DISCORD_TOKEN and DISCORD_CLIENT_ID.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host '  1. Edit .env'
Write-Host '  2. npm run doctor'
Write-Host '  3. npm run deploy'
Write-Host '  4. npm start'
Write-Host ''
Write-Host 'To run automatically at boot:'
Write-Host '  powershell -ExecutionPolicy Bypass -File scripts/install-windows-task.ps1' -ForegroundColor Yellow
