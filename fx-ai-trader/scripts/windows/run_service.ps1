# Runs the fxai trading service with output appended to logs\service.log.
# Restarts are handled by Task Scheduler (see register_tasks.ps1).
param([string]$InstallDir = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
Set-Location $InstallDir
New-Item -ItemType Directory -Force -Path logs | Out-Null
& "$InstallDir\.venv\Scripts\python.exe" -m fxai service *>> "$InstallDir\logs\service.log"
exit $LASTEXITCODE
