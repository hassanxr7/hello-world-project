# Installation and Windows/VPS deployment

MT4 runs only on Windows (or Wine), and the file bridge needs MT4 and the Python service on the
**same machine**. A Windows VPS close to your broker's servers is the usual setup.

> Short version: [VPS_QUICKSTART.md](VPS_QUICKSTART.md). `scripts\windows\setup_vps.ps1` automates steps 1.4-1.5
> and section 2 below, and `python -m fxai doctor` checks the whole chain (read-only).

## Requirements

| Item | Notes |
|---|---|
| Windows 10/11 or Windows Server 2019+ (64-bit) | 2 vCPU / 4 GB RAM is enough for one terminal |
| MetaTrader 4 terminal | from your broker (build 1400+ recommended; the EA needs build ≥ 600 features: `FILE_COMMON`, `FileMove`, `FileFindFirst`, millisecond timer) |
| MT4 **demo** account | start here |
| Python 3.13 (64-bit) | tested with 3.13; 3.12 is expected to work |
| Disk | < 200 MB plus logs and database |

## 1. MetaTrader 4

1. Install the broker's MT4 and log in to a **demo** account.
2. *Tools → Options → Expert Advisors*: tick **Allow automated trading**. Leave **Allow DLL
   imports** unticked (not needed) and leave the WebRequest list empty (not used).
3. *Account History* tab → right-click → **All History** (needed for cash flows and recounts).
4. Open *File → Open Data Folder*, then copy:
   - `mql4/Experts/FXAI_Bridge.mq4` → `MQL4\Experts\`
   - `mql4/Scripts/FXAI_ExportHistory.mq4` → `MQL4\Scripts\` (optional)
5. Open MetaEditor (F4), open both files, press **Compile** (F7). Fix anything reported; see
   [VERIFICATION.md](VERIFICATION.md). There must be **0 errors**; review every warning.
6. Make sure every symbol you trade is in *Market Watch* (right-click → Show All, or add them).
   Note the broker suffix (e.g. `EURUSD.r`).
7. Open **one** chart (any symbol, e.g. EURUSD H1) and attach `FXAI_Bridge`:
   - *Common* tab: allow live trading (this only lets the EA call `OrderSend`; the EA input
     `EnableTrading` still controls entries).
   - *Inputs*: keep `EnableTrading=false` and `AllowLiveAccount=false` for the first run; set
     `SymbolSuffix`/`SymbolPrefix`; keep `MagicNumber` equal to `bridge.magic_number`;
     choose `ResetZone`/`ResetHour` to match `daily_reset` in the config;
     `BarTimeframes` must include the strategy timeframes (default `M15,H1,H4`).
8. The chart's top-left shows `FXAI Bridge 1.0.0 [ACTIVE]`. The *Experts* tab shows
   `INIT ... folder Common\Files\FXAI\<login>`.

## 2. Python service

```powershell
cd C:\fxai\fx-ai-trader
py -3.13 -m venv .venv
.venv\Scripts\pip install -r requirements.txt
# optional, only for the LLM review:  .venv\Scripts\pip install -r requirements-llm.txt
copy config\config.example.yaml config\config.yaml
copy config\.env.example .env
.venv\Scripts\python -m fxai hash-password     # paste into .env as FXAI_DASHBOARD_PASSWORD_HASH
.venv\Scripts\python -m fxai gen-secret        # paste into .env as FXAI_SECRET_KEY
```

Edit `config\config.yaml`: `symbols.suffix`, `symbols.enabled`, your broker's
`risk.commission_per_lot_round_turn`, and `daily_reset` (same as the EA). `bridge.root: auto`
resolves `%APPDATA%\MetaQuotes\Terminal\Common\Files\FXAI`. If several accounts write there, set
`bridge.account` to the login number.

Run (two consoles, or the scheduled tasks below):

```powershell
.venv\Scripts\python -m fxai service
.venv\Scripts\python -m fxai dashboard          # http://127.0.0.1:8787
```

Keep `.env` readable only by your user:
`icacls .env /inheritance:r /grant:r "%USERNAME%:R"`.

## 3. Run automatically on a VPS

`scripts/windows/register_tasks.ps1` registers two Task Scheduler tasks that start at logon,
restart on failure and run hidden:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\register_tasks.ps1 -InstallDir C:\fxai\fx-ai-trader
```

- MT4 must also start at logon: put a shortcut to `terminal.exe` in `shell:startup`, and enable
  auto-login for the VPS user (or keep the RDP session disconnected, not logged off).
- Windows Update: set active hours, or schedule restarts on weekends. The EA restores its state
  after a restart; the service reconciles on start.
- Time: keep the Windows time service on. `TimeGMT()` and Python both use the PC clock, and
  heartbeats compare them.

## 4. Dashboard access from your PC

The dashboard binds to `127.0.0.1`. Options:
- RDP to the VPS and open it there, or
- SSH port forward: `ssh -L 8787:127.0.0.1:8787 user@vps` (OpenSSH Server on Windows), or
- an HTTPS reverse proxy (Caddy/IIS) with `dashboard.secure_cookies: true` and firewall rules
  limited to your IP. Never expose plain HTTP to the internet.

## 5. Backtesting on your broker's data

1. In MT4, run `FXAI_ExportHistory` on any chart (Timeframe M1, enough history loaded) to write
   files to `Common\Files\FXAI\export\`.
2. Rename them to `<SYMBOL>.csv` in a folder and run
   `python -m fxai validate --data-root <folder> --data-format mt4 --server-offset <hours>`.
   MT4 bars are bid prices; the spread column is often 0 in MT4 history, in which case the cost
   model's spreads are used.

## Uninstall

Remove the EA from the chart, delete `MQL4\Experts\FXAI_Bridge.*`, the folder
`Common\Files\FXAI`, the GlobalVariables starting with `FXAI_` (F3 in MT4), the scheduled tasks,
and the install folder.
