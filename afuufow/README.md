# Afuufow — Somali-speaking Windows AI assistant

Afuufow is a male Somali-speaking personal assistant for **Hassan Mohamed Mohamud (Mudane Hassan Mohamed, "Boss Hassan XR")**. It runs in the Windows tray after you sign in, listens for the wake word **"Afuufow"** (or push-to-talk / typed text), understands Somali and mixed Somali–English commands, performs computer tasks, and — if you enable it — recognises you by camera, greets you, and keeps a careful log of unrecognised people.

> **Read first:** [Limitations and verification status](docs/LIMITATIONS.md) says exactly what is working, what was tested where, and what is not possible.

## What it does
* **Voice:** wake word on-device, speech-to-text (Azure `so-SO` by default), AI reply streamed sentence by sentence, **Somali male neural voice** (`so-SO-MuuseNeural`). "Jooji", "Sug", "Aamus" interrupt speech and tasks at once. It ignores its own voice.
* **Greeting:** exactly *"Mudane Hassan Mohamed, Boss Hassan XR, waan taaganahay."* when it recognises you or you activate it (cool-down prevents repeats). *"Fariiso."* → *"Waan fadhiistay Boss. Maxaan qabtaa? Shaqo ii dir."*
* **Windows automation** (structured tools, permissions, cancellation, verification): open apps, folders, files in approved folders, websites, search, YouTube play/pause/resume (verified in its own player window), volume, media keys, screenshots, read the screen (UI Automation/OCR), draft and paste text, WhatsApp messages.
* **WhatsApp:** resolves approved contacts and aliases, asks when several match, separates **draft / send / read-back**, optional fast-send for approved contacts, verifies the message appeared in the chat and reports the real status (*sent*, *delivered*, *read* only when WhatsApp shows it).
* **Face recognition (optional):** guided enrollment, thresholds with an honest "uncertain" zone, lighting feedback, liveness check, local processing only, no video stored.
* **Unknown people:** fixed Somali questions, consent notice spoken first, self-reported answers stored separately from camera observations and Windows unlock events; report to you only after your identity is verified.
* **AI hands (camera):** with the camera on, wave an open hand and the window turns into a full-screen stage where Afuufow's glowing AI hands copy your hands (21 points per hand, up to two hands); *Esc* closes it, or press **🖐 Gacmaha AI** to open it yourself. Only landmark numbers are processed; no picture is stored or sent. Setting: Settings → Camera → hand stage (auto / manual / off).
* **Task agent (optional):** hand multi-step computer jobs (sort/rename many files, scripts, research) to the **Open Interpreter** engine with *“wakiilka: …”*; **every command it wants to run is shown to you first**, deleting/messaging/payments need Windows Hello/PIN too, and it answers in Somali. Off until you install and enable it. See [docs/INTERPRETER.md](docs/INTERPRETER.md) and the [demo transcript](docs/DEMO_AGENT_TRANSCRIPT.md).
* **Companion mode:** it can start a short friendly chat on its own while you are around and keeps listening for your answer without the wake word.
* **Memory:** encrypted; verified owner facts kept apart from anything others say; view/correct/export/delete; retention periods.
* **Privacy controls:** everything cloud is off until you allow it; instant mic/camera pause; secrets in Windows DPAPI.

## Install (users)
Download `Afuufow-Setup-x.y.z.exe` from the project's CI artifacts / releases, run it (no admin rights needed) and follow the setup wizard. Guides: [English](docs/GUIDE_EN.md) · [Soomaali](docs/GUIDE_SO.md). Build it yourself: [docs/BUILD.md](docs/BUILD.md).

## Develop
```powershell
cd afuufow
npm ci
npm test            # unit tests (OS-independent core)
npm start           # build + launch
npm run dist:win    # installer (Windows)
```
Layout: `src/core` (pure logic, tested) · `src/main` (Electron runtime, Windows adapter, drivers) · `src/workers` (hidden mic/camera pages) · `src/ml` (on-device ML process) · `src/renderer` (UI) · `tests` (unit + e2e) · `docs`.

## Documents
[Architecture](docs/ARCHITECTURE.md) · [Privacy and data](docs/PRIVACY_AND_DATA.md) · [Hardware, internet, costs](docs/HARDWARE_AND_COSTS.md) · [Speech evaluation (measured)](docs/SPEECH_EVALUATION.md) · [Manual test checklist](docs/TEST_CHECKLIST.md) · [Build/update/uninstall](docs/BUILD.md) · [Task agent (Open Interpreter)](docs/INTERPRETER.md) · [Reference project analysis](docs/REFERENCE_MAYA.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

## Important honesty notes
* Afuufow is an ordinary desktop program. It **cannot** monitor before Windows sign-in, bypass or replace the lock screen, or act as a Windows credential.
* On-device **Somali** speech recognition was measured at ≈100 % word error rate and is disabled; good Somali recognition needs the cloud (Azure) and a key. Cloud accuracy on your voice is not measured in this repository (see the evaluation harness).
* WhatsApp's terms restrict automation of its service; use at your own risk. The WhatsApp Web page selectors are not verified against the live site by the test suite.
* The licence is MIT (see `LICENSE`); change it if you prefer.
