# Stops the headless wrapper and the bot process. The wrapper is stopped first
# so it cannot restart the bot after we terminate it.
$Root = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $Root 'data'
$botPidFile = Join-Path $dataDir 'bot.pid'
$runPidFile = Join-Path $dataDir 'run.pid'
$runScript = Join-Path $Root 'run.ps1'

function Get-IntFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $text = (Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($text -match '^\d+$') { return [int]$text }
    return $null
}

$wrapperIds = @()
$wrapperPid = Get-IntFile $runPidFile
if ($wrapperPid) {
    $record = Get-CimInstance Win32_Process -Filter "ProcessId=$wrapperPid" -ErrorAction SilentlyContinue
    if ($record -and $record.CommandLine -match 'run\.ps1') { $wrapperIds += $wrapperPid }
}
# Also find an old wrapper that predates data\run.pid.
$foundWrappers = Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -eq 'powershell.exe' -and
        $_.CommandLine -and
        $_.CommandLine -notmatch '-Command' -and
        $_.CommandLine -match ('-File\s+"?' + [regex]::Escape($runScript))
    }
foreach ($record in $foundWrappers) {
    if ($wrapperIds -notcontains $record.ProcessId) { $wrapperIds += $record.ProcessId }
}

$nodeIds = @()
$botPid = Get-IntFile $botPidFile
if ($botPid) {
    $record = Get-CimInstance Win32_Process -Filter "ProcessId=$botPid" -ErrorAction SilentlyContinue
    if ($record -and $record.Name -eq 'node.exe' -and $record.CommandLine -match 'src[\\/]index\.js') {
        $nodeIds += $botPid
    }
}
# Capture the wrapper's child node process before stopping the wrapper.
foreach ($wrapperId in $wrapperIds) {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$wrapperId" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'src[\\/]index\.js' }
    foreach ($child in $children) {
        if ($nodeIds -notcontains $child.ProcessId) { $nodeIds += $child.ProcessId }
    }
}

if ($wrapperIds.Count -eq 0 -and $nodeIds.Count -eq 0) {
    Remove-Item -LiteralPath $botPidFile, $runPidFile -Force -ErrorAction SilentlyContinue
    Write-Host 'DiscordMusicBot is not running.' -ForegroundColor Yellow
    exit 0
}

foreach ($wrapperId in $wrapperIds) {
    Stop-Process -Id $wrapperId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 300
foreach ($nodeId in $nodeIds) {
    Stop-Process -Id $nodeId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 500

Remove-Item -LiteralPath $botPidFile, $runPidFile -Force -ErrorAction SilentlyContinue
Write-Host ("Stopped DiscordMusicBot (wrapper: {0}; bot: {1})." -f (($wrapperIds -join ', ') -replace '^$', 'none'), (($nodeIds -join ', ') -replace '^$', 'none')) -ForegroundColor Green

