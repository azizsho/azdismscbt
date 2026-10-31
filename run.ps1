param(
    [string]$NodePath = 'node'
)

# Starts the bot with a simple crash-restart loop and appends output to a log.
# Used by the Windows scheduled task and handy for manual runs.
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

# Decode native child output as UTF-8 so non-ASCII song titles survive logging.
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$logDir = Join-Path $Root 'data\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'bot.log'
$runPidFile = Join-Path $Root 'data\run.pid'
Set-Content -Path $runPidFile -Value $PID -Encoding ASCII

# Keep a single previous log file so this cannot grow forever.
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 20MB)) {
    Move-Item -Force $log "$log.1"
}

try {
    while ($true) {
        $started = Get-Date -Format o
        Add-Content -Path $log -Value "[$started] starting $NodePath src/index.js" -Encoding UTF8
        # Redirect through the pipeline so the log stays UTF-8 instead of the
        # UTF-16 encoding that Windows PowerShell's *>> operator uses.
        & $NodePath src/index.js 2>&1 | ForEach-Object {
            Add-Content -Path $log -Value $_ -Encoding UTF8
        }
        $code = $LASTEXITCODE
        $ended = Get-Date -Format o
        Add-Content -Path $log -Value "[$ended] bot exited with code $code" -Encoding UTF8

        # A clean exit is an intentional shutdown; do not restart.
        if ($code -eq 0) { break }
        Start-Sleep -Seconds 5
    }
}
finally {
    Remove-Item $runPidFile -Force -ErrorAction SilentlyContinue
}
