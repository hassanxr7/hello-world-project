# Emergency stop from the desktop shortcut. Works even if the service or dashboard is down:
# it writes the EA's estop.flag directly. The EA reacts within about one second.
param([string]$InstallDir = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
Set-Location $InstallDir
Write-Host "FXAI EMERGENCY STOP" -ForegroundColor Red
Write-Host "  1 = block new entries AND close all system positions now"
Write-Host "  2 = block new entries, keep open positions with their stop-losses"
Write-Host "  anything else = cancel"
$a = Read-Host "Choose 1 or 2"
$policy = if ($a -eq "1") { "close_all" } elseif ($a -eq "2") { "hold" } else { "" }
if (-not $policy) { Write-Host "Cancelled - nothing changed."; exit 0 }
& "$InstallDir\.venv\Scripts\python.exe" -m fxai estop --policy $policy
if ($LASTEXITCODE -eq 0) {
    Write-Host "Emergency stop set ($policy). Clear it later in the dashboard ('Clear emergency stop', type CLEAR)." -ForegroundColor Yellow
} else {
    Write-Host "Could not write the stop flag. In MT4, open the EA's inputs and set EnableTrading=false, or remove it from the chart." -ForegroundColor Red
}
