# Registers two Task Scheduler tasks (current user, at logon, restart on failure):
#   fxai-service    -> scripts\windows\run_service.ps1
#   fxai-dashboard  -> scripts\windows\run_dashboard.ps1
# Usage (PowerShell as the VPS user that runs MT4):
#   powershell -ExecutionPolicy Bypass -File scripts\windows\register_tasks.ps1 -InstallDir C:\fxai\fx-ai-trader
param([Parameter(Mandatory = $true)][string]$InstallDir)

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -StartWhenAvailable -MultipleInstances IgnoreNew
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

foreach ($name in @("service", "dashboard")) {
    $script = Join-Path $InstallDir "scripts\windows\run_$name.ps1"
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -InstallDir `"$InstallDir`"" `
        -WorkingDirectory $InstallDir
    Register-ScheduledTask -TaskName "fxai-$name" -Action $action -Trigger $trigger -Settings $settings `
        -Principal $principal -Force | Out-Null
    Write-Host "registered fxai-$name"
}
Write-Host "Start now with: Start-ScheduledTask -TaskName fxai-service; Start-ScheduledTask -TaskName fxai-dashboard"
