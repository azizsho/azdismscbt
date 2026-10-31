# Starts the bot headless (no window), using run.ps1 for crash-restart and logs.
$Root = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $Root 'data'
$botPidFile = Join-Path $dataDir 'bot.pid'
$runPidFile = Join-Path $dataDir 'run.pid'
$log = Join-Path $dataDir 'logs\bot.log'

function Get-IntFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $text = (Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($text -match '^\d+$') { return [int]$text }
    return $null
}

function Test-Bot([int]$ProcessId) {
    $record = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    return ($record -and $record.Name -eq 'node.exe' -and $record.CommandLine -match 'src[\\/]index\.js')
}

$botPid = Get-IntFile $botPidFile
if ($botPid -and (Test-Bot $botPid)) {
    Write-Host "DiscordMusicBot is already running (PID $botPid)." -ForegroundColor Yellow
    & (Join-Path $PSScriptRoot 'status-bot.ps1')
    exit 0
}
Remove-Item -LiteralPath $botPidFile -Force -ErrorAction SilentlyContinue

$wrapper = Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -eq 'powershell.exe' -and
        $_.CommandLine -and
        $_.CommandLine -notmatch '-Command' -and
        $_.CommandLine -match ('-File\s+"?' + [regex]::Escape((Join-Path $Root 'run.ps1')))
    } |
    Select-Object -First 1
if ($wrapper) {
    Write-Host "Wrapper is already running (PID $($wrapper.ProcessId)); waiting for the bot to come up..." -ForegroundColor Yellow
} else {
    $node = (Get-Command node -ErrorAction Stop).Source
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$Root\run.ps1`" -NodePath `"$node`""
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory $Root -WindowStyle Hidden -PassThru
    Write-Host "Started headless wrapper (PID $($process.Id))." -ForegroundColor Green
}

$deadline = (Get-Date).AddSeconds(25)
$ready = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $currentPid = Get-IntFile $botPidFile
    if ($currentPid -and (Test-Bot $currentPid)) {
        $ready = $true
        break
    }
}

if ($ready) {
    Write-Host 'Bot process is up.' -ForegroundColor Green
} else {
    Write-Host 'The bot did not report a PID within 25 seconds. Check the log below.' -ForegroundColor Red
}
Write-Host ''
if (Test-Path -LiteralPath $log) {
    Get-Content -LiteralPath $log -Tail 12 -Encoding UTF8 -ErrorAction SilentlyContinue
}
Write-Host ''
if (-not $ready) { exit 1 }

