# VPS quickstart (about 20 minutes)

All commands run in **PowerShell** on the VPS, as the Windows user that runs MT4.
Details and alternatives: [INSTALL_WINDOWS_VPS.md](INSTALL_WINDOWS_VPS.md).

## 0. Prerequisites

- MT4 from your broker, installed and **logged in to a demo account**.
- Python 3.13 (64-bit) from python.org with the "py launcher" option, or let the setup script
  install it with `-InstallPython`.
- Optional: Git for Windows.

## 1. Get the code

```powershell
git clone -b ccr-4ece60e2-b0u54h https://github.com/hassanxr7/hello-world-project.git C:\fxai
cd C:\fxai\fx-ai-trader
```

No Git? On GitHub, switch to branch `ccr-4ece60e2-b0u54h` → **Code → Download ZIP**, extract
to `C:\fxai`, then `cd C:\fxai\<extracted folder>\fx-ai-trader`. If the repository is private,
Git opens a browser window to sign in.

## 2. Run the setup script

Find your broker's symbol suffix first: in MT4 Market Watch, EURUSD may appear as `EURUSD`,
`EURUSD.r`, `EURUSDm`, and so on. The suffix is the part after `EURUSD` (empty if none).

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\setup_vps.ps1 -Suffix ".r" -RunTests
```

The script:
1. creates `.venv` and installs the pinned packages;
2. runs the test suite on Windows (`-RunTests`; output in `logs\test_output_windows.txt`);
3. creates `config\config.yaml` with your suffix;
4. asks for a dashboard password and writes `.env` (hash and session key only, readable by
   your user only);
5. copies the EA into every MT4 data folder and **tries to compile it** with MetaEditor's
   command line (log in `logs\compile_FXAI_Bridge.log`).

Re-running it is safe: existing config and `.env` are kept.

## 3. MT4 settings

1. *Tools → Options → Expert Advisors*: tick **Allow automated trading**.
2. *Terminal → Account History* → right-click → **All History**.
3. Make sure EURUSD, GBPUSD, USDJPY, USDCAD, AUDUSD, USDCHF and NZDUSD (with your suffix) are in
   Market Watch (right-click → Show All).
4. If the compile step did not report success, open `MQL4\Experts\FXAI_Bridge.mq4` in
   MetaEditor (F4) and press **F7**.
5. Open **one** chart (EURUSD H1) and drag **FXAI_Bridge** onto it:
   - *Common*: tick **Allow live trading** (lets the EA place orders at all).
   - *Inputs*: `EnableTrading = false` for now, `SymbolSuffix` = your suffix, everything else
     at its default.
   - The chart must show `FXAI Bridge 1.0.0 [ACTIVE]`.

## 4. Diagnose and send me the output

Wait about a minute (the EA writes bar history), then:

```powershell
cd C:\fxai\fx-ai-trader
.venv\Scripts\python -m fxai doctor
```

Paste the whole output into the chat. It contains no passwords or keys. Also paste the
compile result if it showed errors or warnings.

## 5. Start the system (still no trading)

```powershell
.venv\Scripts\python -m fxai service          # window 1
.venv\Scripts\python -m fxai dashboard        # window 2 -> open http://127.0.0.1:8787 on the VPS
```

Or register both to start automatically at logon:
`powershell -ExecutionPolicy Bypass -File scripts\windows\register_tasks.ps1 -InstallDir C:\fxai\fx-ai-trader`

Then work through **Stage 0** of [DEMO_AND_LIVE.md](DEMO_AND_LIVE.md). Only after it passes,
set the EA input `EnableTrading = true` (on the **demo** account).
