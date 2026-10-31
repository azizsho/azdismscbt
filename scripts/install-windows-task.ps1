#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs the bot as a Windows Scheduled Task that starts at boot and restarts
  automatically after a crash. Runs as SYSTEM so it does not need a logged-in
  desktop session.

  Run from an elevated PowerShell:
    powershell -ExecutionPolicy Bypass -File scripts/install-windows-task.ps1
#>
$ErrorActionPreference = 'Stop'
$TaskName = 'DiscordMusicBot'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "Project: $Root"

if (-not (Test-Path (Join-Path $Root '.env'))) {
    throw "Missing .env. Run 'npm run setup' and fill in .env first."
}
if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
    throw "Missing node_modules. Run 'npm install' first."
}
if (-not (Test-Path (Join-Path $Root 'tools'))) {
    throw "Missing tools directory. Run 'npm run setup' first."
}

$node = (Get-Command node -ErrorAction Stop).Source
Write-Host "Node: $node"

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Root\run.ps1`" -NodePath `"$node`"" `
    -WorkingDirectory $Root

$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Self-hosted Discord YouTube music bot' `
    -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2

$task = Get-ScheduledTask -TaskName $TaskName
Write-Host ''
Write-Host "Installed scheduled task '$TaskName' (state: $($task.State))."
Write-Host "Logs: $(Join-Path $Root 'data\logs\bot.log')"
Write-Host ''
Write-Host 'Useful commands (elevated PowerShell):'
Write-Host "  Get-ScheduledTask -TaskName $TaskName"
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
Write-Host "  Stop-ScheduledTask -TaskName $TaskName"
Write-Host "  Get-Content '$Root\data\logs\bot.log' -Tail 100 -Wait"
