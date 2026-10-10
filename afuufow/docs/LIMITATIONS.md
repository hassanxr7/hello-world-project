# Working features, verification status and known limitations

"**CI-Windows**" = verified by the GitHub Actions workflow on a real `windows-latest` runner against the **installed** app (`.github/workflows/afuufow.yml`; see the run log). "**Linux-e2e**" = real Electron app on Linux with a fake microphone/camera. "**Unit**" = automated tests of the OS-independent core. "**Not verified**" = implemented but never exercised against the real service/device in this repository; it may need adjustments on your machine.

## Installer and lifecycle
| Feature | Status |
|---|---|
| NSIS per-user installer builds | **CI-Windows** |
| Silent install: program files, ML native addon, Start-menu shortcut, Add/Remove entry | **CI-Windows** |
| Silent uninstall removes program and registry entry | **CI-Windows** (see run log for the final run) |
| Desktop shortcut, interactive installer pages, uninstall data-deletion prompt | Not verified (configured in `electron-builder.yml` / `installer/installer.nsh`) |
| Start automatically after Windows sign-in (`openAtLogin`, `--background`, hidden window, tray) | Implemented; **not verified** across a real sign-out/sign-in (use the manual checklist) |
| Tray icon, menu, global shortcuts | Implemented; **not verified** on Windows (headless runner has no tray) |
| Crash recovery (UI renderer recreated, ML process restarted, relaunch after repeated errors) | Implemented; not fault-injected |
| Single instance, exit option | Implemented; not verified |

## Voice and AI
| Feature | Status |
|---|---|
| Somali commands/mixed Somali–English → intents, exact greeting and "Fariiso" responses, stop words, own-voice filtering, contact/app/YouTube clarification | **Unit** (≈300 tests) |
| Microphone capture in the real app, live level, instant stop on pause | **CI-Windows** and **Linux-e2e** (fake device) |
| On-device wake word model loads and runs | Measured: 0 false alarms in 47 min of Somali speech; 10/20 *synthetic* "Afuufow" clips detected (see SPEECH_EVALUATION). **Real-voice detection rate unknown.** |
| Somali speech-to-text (Azure) and Somali male voice (Azure) | Implemented per Microsoft's REST API; **not verified** (no key available). Accuracy/latency **unknown** until you run the harness. |
| On-device Somali recognition | **Measured unusable (≈100 % WER) → disabled** |
| English offline voice (SAPI) | Implemented; not verified |
| Ollama / OpenAI-compatible / Anthropic chat, streaming into sentence-level speech | Unit-tested with fakes; **not verified** against live services |
| Streaming speech-to-text | Not implemented (audio is sent after end-of-utterance) |

## Windows automation (real PowerShell adapter)
| Feature | Status |
|---|---|
| Open an application and verify its window ("Notepad fur") | **CI-Windows** |
| Open a folder and verify the Explorer window | Fixed after the first CI run (shell COM detection); see latest run |
| Screenshot saved and verified | **CI-Windows** |
| Volume read/set/mute via Core Audio | Script parses; on the runner there is no audio device, so it failed honestly. **Not verified on real audio hardware.** |
| Media keys, focus window, paste (Ctrl+V), UI Automation text, Windows OCR, Recycle Bin, winget, Windows Hello | Scripts syntax-checked on Windows PowerShell 5.1 in CI; **not executed** on real data. Windows Hello from a background process may not show its prompt; the PIN is the dependable path. |
| File search, approved-folder containment, URL scheme checks, injection-safe parameter passing | **Unit** |
| Deleting files / installing software | Gated behind PIN/Hello + explicit yes; only reachable through an AI plan; **not executed** on a real system |

## WhatsApp and YouTube
| Feature | Status |
|---|---|
| Contact resolution, ambiguity questions, approvals, draft/send/read-back, fast-send, duplicate guard, presence requirement, honest delivery wording | **Unit** (fake WhatsApp) |
| WhatsApp Web page script and controller against a **mock** DOM | **Unit** (jsdom). **The real WhatsApp Web markup was not available**; selectors (`#pane-side`, `footer [contenteditable]`, `[data-id^="true_"]`, `aria-label` states) are from public knowledge and may be wrong or change. When they fail the app reports failure and does not send. |
| WhatsApp Desktop | Opens a chat with text pre-filled; cannot read or send (reported as such) |
| WhatsApp terms | Automated use is restricted by WhatsApp; accounts may be limited. Rate-limited to 20/hour. |
| YouTube result parsing and ranking | **Unit** with fixtures; live page format not guaranteed (set a Data API key for stability) |
| YouTube playback verification in the Afuufow player window | Implemented (reads the `<video>` state); **not verified** against live YouTube (consent pages, ads) |

## Face, voice recognition and visitors
| Feature | Status |
|---|---|
| Presence state machine (debounce, thresholds, uncertain band, leave/return, photo flag, cooldowns), enrollment coverage rules, encrypted templates, deletion | **Unit** |
| Face model loads and runs in the camera worker | **CI-Windows** (fake camera, no face) and Linux-e2e |
| **Recognition accuracy on real faces** | **Not measured.** Default thresholds (0.62 / 0.45) follow the library's guidance and are re-suggested at enrollment; they are not benchmarked. |
| Anti-photo check | Uses the library's anti-spoof and liveness models; **not evaluated**. Does not stop replayed video or deepfakes. |
| Speaker (voice) recognition | Model download and API implemented; **not evaluated** on real voices. Policy (voice never authorises sensitive actions) is unit-tested. |
| Unknown-person flow: exact Somali wording, notice before recording, decline/silence/interruption, self-reported storage, optional disclosed snapshot/audio, separate Windows events, report only after verification and not aloud when others are present | **Unit** |
| Windows lock/unlock events | `powerMonitor` events while Afuufow runs; Security-log import needs elevation and usually reports unavailable |

## Boundaries that cannot be changed by software like this
* No monitoring before Windows sign-in; no lock-screen bypass or replacement; face/voice are not Windows credentials.
* Windows ships no offline Somali voice.
* A photo or screen can sometimes fool any 2-D face recognition; a replayed video can fool the liveness check.
* Browser-based integrations break when the sites change their pages.

## Known gaps
* No automatic updates (run the new installer).
* English-only offline speech; Somali needs the cloud.
* The reference project (Maya AI 1.2) has no licence file; nothing was copied.
* No code signing: Windows SmartScreen will warn on first run unless you sign the installer.
