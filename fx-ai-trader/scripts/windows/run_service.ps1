# Runs the fxai trading service, appending output to logs\service.log.
# If it exits (for example because the EA is not attached yet, so its bridge folder does not
# exist), it is restarted after 30 s. Stop it with: Stop-ScheduledTask fxai-service
param([string]$InstallDir = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
Set-Location $InstallDir
$env:PYTHONUTF8 = "1"  # UTF-8 output even when redirected to a log file
New-Item -ItemType Directory -Force -Path logs | Out-Null
$log = Join-Path $InstallDir "logs\service.log"
while ($true) {
    if ((Test-Path $log) -and (Get-Item $log).Length -gt 20MB) { Move-Item $log "$log.1" -Force }
    & "$InstallDir\.venv\Scripts\python.exe" -m fxai service *>> $log
    $code = $LASTEXITCODE
    Add-Content -Path $log -Value ("{0} service exited with code {1}; restarting in 30 s" -f (Get-Date).ToString("u"), $code)
    Start-Sleep -Seconds 30
}
