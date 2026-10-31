#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Stops and removes the Windows Scheduled Task. Cached audio and .env are kept.
#>
$ErrorActionPreference = 'Stop'
$TaskName = 'DiscordMusicBot'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "Task '$TaskName' is not installed."
    exit 0
}

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Removed scheduled task '$TaskName'."
