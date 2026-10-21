# Runs the fxai dashboard (127.0.0.1:8787 by default), appending output to logs\dashboard.log.
# Restarted after 15 s if it exits. Stop it with: Stop-ScheduledTask fxai-dashboard
param([string]$InstallDir = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
Set-Location $InstallDir
$env:PYTHONUTF8 = "1"  # UTF-8 output even when redirected to a log file
New-Item -ItemType Directory -Force -Path logs | Out-Null
$log = Join-Path $InstallDir "logs\dashboard.log"
while ($true) {
    if ((Test-Path $log) -and (Get-Item $log).Length -gt 20MB) { Move-Item $log "$log.1" -Force }
    & "$InstallDir\.venv\Scripts\python.exe" -m fxai dashboard *>> $log
    $code = $LASTEXITCODE
    Add-Content -Path $log -Value ("{0} dashboard exited with code {1}; restarting in 15 s" -f (Get-Date).ToString("u"), $code)
    Start-Sleep -Seconds 15
}
