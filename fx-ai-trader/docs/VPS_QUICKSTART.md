# VPS quickstart: one command

On the Windows VPS, open **Windows PowerShell** (Start menu, type `powershell`; not the ISE)
and paste this single line:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force; [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072; $f = "$env:TEMP\fxai-setup.ps1"; Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/hassanxr7/hello-world-project/ccr-4ece60e2-b0u54h/fx-ai-trader/scripts/windows/setup_vps.ps1" -OutFile $f; & $f
```

To install one exact, reviewed version, replace both occurrences of the branch name with a commit
id. Use `.../hello-world-project/<commit>/fx-ai-trader/...` in the URL and add `-Ref <commit>`
after `& $f`.

## What it does (5–10 minutes the first time)

| Step | Automatic | Asks you |
|---|---|---|
| 1. Project files | Downloads the version from GitHub over HTTPS into `C:\fxai\fx-ai-trader` and checks that the archive is exactly the requested commit | A GitHub sign-in in the browser, only if the repository is private (device code; the script never sees a password) |
| 2. Python | Uses an existing 64-bit Python 3.13, or installs it from python.org for your user after checking the installer's signature (Python Software Foundation) | - |
| 3. Packages | Creates `.venv` and installs the pinned packages, skipped when unchanged | - |
| 4. Tests | Runs the test suite on the VPS, including the installer's own logic tests under Windows PowerShell 5.1 | - |
| 5. Settings | Creates `config\config.yaml` (**mode: demo**) and `.env`, or keeps existing ones | Dashboard password (hidden). Broker symbol suffix, detected from MT4 when possible (Enter accepts). Commission per lot (Enter = 7.0) |
| 6. MT4 + EA | Finds MT4, installs `FXAI_Bridge.mq4` with your suffix as its default, compiles it with MetaEditor and checks the log and the new `.ex4` | - |
| 7. Service + dashboard | Registers tasks that start at logon and restart if they stop, then starts them | - |
| 8. Shortcuts | Desktop: FXAI Dashboard, Doctor, Emergency Stop, Restart, Update, Logs | - |
| 9. Diagnostics | Runs `fxai doctor` and prints a summary, also saved to `C:\fxai\install-summary.txt` | - |

The summary marks every item:
- **OK:** done and verified.
- **TODO:** a manual step. Only the next one is shown, with instructions.
- **WARN:** worth a look, but nothing is broken.
- **FAIL:** something did not work. Send me `C:\fxai\install-summary.txt`, which contains no
  passwords.

Nothing is reported as compiled or running unless it was checked.

## The manual steps it cannot do for you

1. **Install MT4 from your broker** and log in to a demo account, if MT4 is not there yet. Then
   run the command again.
2. **Attach the EA to one chart.** Open a new EURUSD chart, drag FXAI_Bridge from the Navigator
   onto it, tick "Allow live trading" on the Common tab and click OK. The Inputs need no
   changes. The chart must show `FXAI Bridge ... [ACTIVE]`. Then double-click **FXAI Doctor**
   on the desktop.

Keep the Windows session signed in. Close the Remote Desktop window instead of signing out, so
that MT4, the service and the dashboard keep running.

## Safety

- **Trading stays demo-only.**
  - New configs use `mode: demo`.
  - The EA keeps `EnableTrading=false` and `AllowLiveAccount=false`.
  - The installer never changes a risk limit.
  - It does not start the service if the config says `mode: live`.
- **Re-running is safe.** Existing settings are kept. Anything the installer must change is
  first copied to `C:\fxai\backups\<time>`, and so is the previous code on an update.
- **The emergency stop works without the service.** The desktop shortcut writes the EA's stop
  flag directly.

## Update, logs, uninstall

- **Update:** double-click **FXAI Update**, or paste the command again.
- **Logs:** installer logs are in `C:\fxai\install-logs`. Service, dashboard, test and compile
  logs are in `C:\fxai\fx-ai-trader\logs`.
- **Uninstall:**

  ```powershell
  Unregister-ScheduledTask fxai-service -Confirm:$false; Unregister-ScheduledTask fxai-dashboard -Confirm:$false
  ```

  Then delete `C:\fxai` and the `FXAI_Bridge` files in MT4's `MQL4\Experts` folder.

Options for the script: `Get-Help C:\fxai\fx-ai-trader\scripts\windows\setup_vps.ps1 -Detailed`.
The main ones are `-SkipTests`, `-Suffix ".r"`, `-NoStart`, `-InstallDir D:\fxai` and
`-Unattended`. Manual installation is described in [INSTALL_WINDOWS_VPS.md](INSTALL_WINDOWS_VPS.md).
