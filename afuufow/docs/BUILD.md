# Build, install, update, uninstall

## Requirements to build
* Windows 10/11 x64 (official installer builds), Node.js 22+, npm 10+, Git.
* Internet (npm, Electron and NSIS binaries are downloaded).

## Reproducible build

```powershell
git clone https://github.com/hassanxr7/hello-world-project.git
cd hello-world-project\afuufow
npm ci                 # exact versions from package-lock.json
npm run typecheck
npm test               # unit tests (set $env:AFUUFOW_PWSH='powershell.exe' to also syntax-check every embedded PowerShell script)
npm run dist:win       # -> release\Afuufow-Setup-<version>.exe
```

The GitHub Actions workflow `.github/workflows/afuufow.yml` performs exactly this on `windows-latest`, then silently installs the result, launches the **installed** app through an end-to-end test, and silently uninstalls it. Its run log is the evidence of what was built and tested.

Development run: `npm start` (builds, then launches Electron).

> Cross-building the installer from Linux is **not** supported by this repository: the final NSIS step needs Wine. Always build on Windows (or in the provided workflow).

## Install
Run `Afuufow-Setup-x.y.z.exe`. It is **per-user**: no administrator rights, installs under `%LOCALAPPDATA%\Programs\Afuufow` (changeable), creates Start-menu and desktop shortcuts and an *Apps & features* entry. On first launch the setup wizard runs. Turn on *Start after I sign in to Windows* (Setup → Finish, or Settings) to register the startup entry.

Silent install (IT/testing): `Afuufow-Setup-x.y.z.exe /S /D=C:\Path\To\Install`.

## Update
Run the newer installer over the old one. The installer closes the running app, replaces the program files and **keeps** your data (`%APPDATA%\Afuufow`: memory, faces, voice, visitor log, settings, downloaded models). There is no silent auto-update; nothing is downloaded behind your back.

## Uninstall
*Settings → Apps → Afuufow → Uninstall* (or `Uninstall Afuufow.exe`). It removes the program, shortcuts and the *start with Windows* entry and asks whether to also delete `%APPDATA%\Afuufow`. Silent uninstall keeps the data. To wipe everything first, use *Privacy & Data → Delete all my data*.

## Where things live
| What | Where |
|---|---|
| Program | `%LOCALAPPDATA%\Programs\Afuufow` |
| Data (encrypted) | `%APPDATA%\Afuufow\data` |
| Downloaded models | `%APPDATA%\Afuufow\models` |
| Logs (no audio, no secrets) | `%APPDATA%\Afuufow\logs` |
| Screenshots you request | `Pictures\Afuufow` |
