# Restarts the bot cleanly: stop the wrapper/bot, then start headless again.
& (Join-Path $PSScriptRoot 'stop-bot.ps1')
Start-Sleep -Seconds 1
& (Join-Path $PSScriptRoot 'start-bot.ps1')
