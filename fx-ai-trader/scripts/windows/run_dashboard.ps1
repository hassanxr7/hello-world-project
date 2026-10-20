# Runs the fxai dashboard (127.0.0.1:8787 by default) with output appended to logs\dashboard.log.
param([string]$InstallDir = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
Set-Location $InstallDir
$env:PYTHONUTF8 = "1"  # UTF-8 output even when redirected to a log file
New-Item -ItemType Directory -Force -Path logs | Out-Null
& "$InstallDir\.venv\Scripts\python.exe" -m fxai dashboard *>> "$InstallDir\logs\dashboard.log"
exit $LASTEXITCODE
