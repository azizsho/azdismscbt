param(
    [string]$NodePath = 'node'
)

# Starts the bot with a crash-restart loop and appends output to a log.
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

$script:logLines = 0

# Rotate while the bot runs, not just at wrapper startup.
function Write-BotLine([string]$line) {
    Add-Content -Path $log -Value $line -Encoding UTF8
    $script:logLines++
    if ($script:logLines % 500 -eq 0 -and (Test-Path $log) -and ((Get-Item $log).Length -gt 20MB)) {
        Move-Item -Force $log "$log.1"
    }
}

if ((Test-Path $log) -and ((Get-Item $log).Length -gt 20MB)) {
    Move-Item -Force $log "$log.1"
}

try {
    $fastFailures = 0
    $backoff = 5
    while ($true) {
        $started = Get-Date
        Write-BotLine ("[{0}] starting {1} src/index.js" -f $started.ToString('o'), $NodePath)
        # Redirect through the pipeline so the log stays UTF-8 instead of the
        # UTF-16 encoding that Windows PowerShell's *>> operator uses.
        & $NodePath src/index.js 2>&1 | ForEach-Object {
            Write-BotLine $_
        }
        $code = $LASTEXITCODE
        $elapsed = ((Get-Date) - $started).TotalSeconds
        Write-BotLine ("[{0}] bot exited with code {1} after {2:N0}s" -f (Get-Date).ToString('o'), $code, $elapsed)

        # A clean exit is an intentional shutdown; do not restart.
        if ($code -eq 0) { break }

        if ($elapsed -lt 60) {
            $fastFailures++
            $backoff = [Math]::Min(300, $backoff * 2)
        } else {
            $fastFailures = 0
            $backoff = 5
        }
        if ($fastFailures -ge 10) {
            Write-BotLine 'Bot failed 10 times in a row; giving up. Check the log above.'
            break
        }
        Write-BotLine ("Restarting in {0} second(s)…" -f $backoff)
        Start-Sleep -Seconds $backoff
    }
}
finally {
    Remove-Item $runPidFile -Force -ErrorAction SilentlyContinue
}
