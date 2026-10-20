<#
.SYNOPSIS
  One-shot setup of fxai on a Windows VPS. Run it from anywhere; it works on the
  fx-ai-trader folder that contains this script. Safe to re-run (existing config
  and .env are kept).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\setup_vps.ps1 -Suffix ".r" -RunTests

.PARAMETER Suffix / Prefix   Broker symbol suffix/prefix written into a NEW config\config.yaml
.PARAMETER InstallPython     Install Python 3.13 with winget if it is missing
.PARAMETER RunTests          Install dev packages and run the test suite on this machine
.PARAMETER RegisterTasks     Register the auto-start tasks for the service and dashboard
.PARAMETER SkipCompile       Do not try to compile the EA with MetaEditor's command line
#>
param(
    [string]$Suffix = "",
    [string]$Prefix = "",
    [switch]$InstallPython,
    [switch]$RunTests,
    [switch]$RegisterTasks,
    [switch]$SkipCompile
)
$ErrorActionPreference = "Stop"
$InstallDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $InstallDir
$env:PYTHONUTF8 = "1"
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  !!  $m" -ForegroundColor Yellow }

# ---------------------------------------------------------------- Python
Step "Python 3.13"
$pyVersion = $null
try { $pyVersion = (& py -3.13 --version) 2>$null } catch { $pyVersion = $null }
if (-not $pyVersion) {
    if ($InstallPython) {
        winget install --exact --id Python.Python.3.13 --scope user --accept-package-agreements --accept-source-agreements
        Warn "Python installed. Close this PowerShell window, open a new one and run this script again."
        exit 0
    }
    throw "Python 3.13 not found. Install it from https://www.python.org/downloads/windows/ (64-bit, tick 'py launcher'), or re-run with -InstallPython"
}
Ok $pyVersion

# ---------------------------------------------------------------- venv + packages
Step "Virtual environment and packages"
$venvPy = Join-Path $InstallDir ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) { & py -3.13 -m venv .venv }
& $venvPy -m pip install --disable-pip-version-check -q --upgrade pip
& $venvPy -m pip install --disable-pip-version-check -q -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw "pip install -r requirements.txt failed" }
Ok "runtime packages installed (pinned versions)"

if ($RunTests) {
    Step "Test suite on this machine"
    & $venvPy -m pip install --disable-pip-version-check -q -r requirements-dev.txt
    New-Item -ItemType Directory -Force -Path logs | Out-Null
    & $venvPy -m pytest -q -p no:cacheprovider *> logs\test_output_windows.txt
    $tail = Get-Content logs\test_output_windows.txt -Tail 3
    if ($LASTEXITCODE -eq 0) { Ok ($tail -join " ") } else { Warn ("tests FAILED - send logs\test_output_windows.txt: " + ($tail -join " ")) }
}

# ---------------------------------------------------------------- config
Step "Configuration"
if (-not (Test-Path config\config.yaml)) {
    $cfg = Get-Content config\config.example.yaml -Raw
    $cfg = $cfg -replace '(?m)^  prefix: ""', ('  prefix: "' + $Prefix + '"')
    $cfg = $cfg -replace '(?m)^  suffix: ""(.*)$', ('  suffix: "' + $Suffix + '"$1')
    [IO.File]::WriteAllText((Join-Path $InstallDir "config\config.yaml"), $cfg, $Utf8NoBom)
    Ok "config\config.yaml created (suffix '$Suffix'). Edit risk.commission_per_lot_round_turn for your broker."
} else {
    Ok "config\config.yaml already exists - left unchanged"
}

# ---------------------------------------------------------------- secrets
Step "Dashboard secrets (.env)"
if (-not (Test-Path .env)) {
    Write-Host "  Choose a dashboard password (at least 12 characters). It is stored only as a hash."
    $hash = & $venvPy -m fxai hash-password
    if ($LASTEXITCODE -ne 0 -or -not $hash) { throw "password setup failed - run the script again" }
    $secret = & $venvPy -m fxai gen-secret
    $content = "FXAI_DASHBOARD_PASSWORD_HASH=$hash`r`nFXAI_SECRET_KEY=$secret`r`n"
    [IO.File]::WriteAllText((Join-Path $InstallDir ".env"), $content, $Utf8NoBom)
    icacls .env /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
    Ok ".env written, readable only by $($env:USERNAME)"
} else {
    Ok ".env already exists - left unchanged"
}

# ---------------------------------------------------------------- MT4
Step "MetaTrader 4 data folders"
$termRoot = Join-Path $env:APPDATA "MetaQuotes\Terminal"
$dataDirs = @(Get-ChildItem $termRoot -Directory -ErrorAction SilentlyContinue |
              Where-Object { Test-Path (Join-Path $_.FullName "MQL4\Experts") })
if ($dataDirs.Count -eq 0) {
    Warn "No MT4 data folder found under $termRoot. Start MT4 once, then re-run this script, or copy mql4\Experts\FXAI_Bridge.mq4 via File > Open Data Folder > MQL4\Experts."
}
foreach ($d in $dataDirs) {
    $origin = ""
    $originFile = Join-Path $d.FullName "origin.txt"
    if (Test-Path $originFile) { $origin = (Get-Content $originFile -Raw).Trim() }
    Copy-Item mql4\Experts\FXAI_Bridge.mq4 (Join-Path $d.FullName "MQL4\Experts") -Force
    Copy-Item mql4\Scripts\FXAI_ExportHistory.mq4 (Join-Path $d.FullName "MQL4\Scripts") -Force
    Ok "EA + export script copied to $($d.FullName)  (terminal: $origin)"
    if ($SkipCompile -or -not $origin) { continue }
    $me = Join-Path $origin "metaeditor.exe"
    if (-not (Test-Path $me)) { Warn "metaeditor.exe not found in $origin - compile in MetaEditor with F7"; continue }
    $src = Join-Path $d.FullName "MQL4\Experts\FXAI_Bridge.mq4"
    $ex4 = [IO.Path]::ChangeExtension($src, ".ex4")
    $log = Join-Path $InstallDir "logs\compile_FXAI_Bridge.log"
    New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
    $before = if (Test-Path $ex4) { (Get-Item $ex4).LastWriteTime } else { [datetime]::MinValue }
    Start-Process -FilePath $me -ArgumentList @("/compile:`"$src`"", "/log:`"$log`"") -Wait -NoNewWindow
    if (Test-Path $log) {
        $text = [IO.File]::ReadAllText($log)
        if ($text.Contains([char]0)) { $text = [IO.File]::ReadAllText($log, [Text.Encoding]::Unicode) }
        $lines = $text -split "`r?`n" | Where-Object { $_ -match "error|warning|Result" }
        $lines | ForEach-Object { Write-Host "      $_" }
    }
    $built = (Test-Path $ex4) -and ((Get-Item $ex4).LastWriteTime -gt $before)
    if ($built) { Ok "compiled -> $ex4 (review any warnings above; send me $log if unsure)" }
    else { Warn "compile did not produce a new .ex4 - open FXAI_Bridge.mq4 in MetaEditor, press F7 and send me the Errors tab text" }
}

# ---------------------------------------------------------------- tasks
if ($RegisterTasks) {
    Step "Auto-start tasks"
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "register_tasks.ps1") -InstallDir $InstallDir
}

Step "Next steps"
Write-Host @"
  1. MT4: Tools > Options > Expert Advisors > tick 'Allow automated trading'
     Account History tab > right-click > All History.
  2. Open ONE chart (e.g. EURUSD H1), drag FXAI_Bridge onto it:
     Common tab: tick 'Allow live trading'.  Inputs: EnableTrading=false (for now),
     SymbolSuffix='$Suffix', MagicNumber=7340001.  The chart must show [ACTIVE].
  3. Wait ~1 minute, then run the diagnostics and send me the output:
       cd $InstallDir
       .venv\Scripts\python -m fxai doctor
  4. Start the service and dashboard (or use -RegisterTasks):
       .venv\Scripts\python -m fxai service
       .venv\Scripts\python -m fxai dashboard      -> http://127.0.0.1:8787
"@
