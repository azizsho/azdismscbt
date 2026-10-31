# Shows whether the bot is running, plus the recent log.
$Root = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $Root 'data'
$log = Join-Path $dataDir 'logs\bot.log'
$botPidFile = Join-Path $dataDir 'bot.pid'
$runPidFile = Join-Path $dataDir 'run.pid'

function Get-IntFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $text = (Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($text -match '^\d+$') { return [int]$text }
    return $null
}

function Get-ProcessRecord([int]$ProcessId) {
    return Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
}

$botProcess = $null
$botPid = Get-IntFile $botPidFile
if ($botPid) {
    $record = Get-ProcessRecord $botPid
    if ($record -and $record.Name -eq 'node.exe' -and $record.CommandLine -match 'src[\\/]index\.js') {
        $botProcess = $record
    } else {
        Remove-Item -LiteralPath $botPidFile -Force -ErrorAction SilentlyContinue
    }
}

$wrapperProcess = $null
$wrapperPid = Get-IntFile $runPidFile
if ($wrapperPid) {
    $record = Get-ProcessRecord $wrapperPid
    if ($record -and $record.CommandLine -match 'run\.ps1') {
        $wrapperProcess = $record
    } else {
        Remove-Item -LiteralPath $runPidFile -Force -ErrorAction SilentlyContinue
    }
}

# Fallback for a wrapper started before the PID files existed.
if (-not $wrapperProcess) {
    $wrapperProcess = Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -eq 'powershell.exe' -and
            $_.CommandLine -and
            $_.CommandLine -notmatch '-Command' -and
            $_.CommandLine -match ('-File\s+"?' + [regex]::Escape((Join-Path $Root 'run.ps1')))
        } |
        Select-Object -First 1
}
if (-not $botProcess -and $wrapperProcess) {
    $child = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($wrapperProcess.ProcessId)" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'src[\\/]index\.js' } |
        Select-Object -First 1
    if ($child) { $botProcess = $child }
}

Write-Host ''
Write-Host 'DiscordMusicBot' -ForegroundColor Cyan
if ($botProcess) {
    $started = (Get-Process -Id $botProcess.ProcessId -ErrorAction SilentlyContinue).StartTime
    Write-Host ("  Bot:      RUNNING  PID {0}  started {1}" -f $botProcess.ProcessId, $started) -ForegroundColor Green
} else {
    Write-Host '  Bot:      STOPPED' -ForegroundColor Yellow
}
if ($wrapperProcess) {
    Write-Host ("  Wrapper:  RUNNING  PID {0}" -f $wrapperProcess.ProcessId)
} else {
    Write-Host '  Wrapper:  not running'
}
Write-Host ("  Folder:   {0}" -f $Root)
Write-Host ("  Log:      {0}" -f $log)
Write-Host ''
if (Test-Path -LiteralPath $log) {
    Write-Host 'Recent log:' -ForegroundColor Cyan
    Get-Content -LiteralPath $log -Tail 8 -Encoding UTF8 -ErrorAction SilentlyContinue
} else {
    Write-Host 'No log file yet.'
}
Write-Host ''

