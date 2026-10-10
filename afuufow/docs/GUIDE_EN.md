# Afuufow — setup guide (English)

## 1. Install
Run `Afuufow-Setup-x.y.z.exe` (per-user, no administrator). Launch **Afuufow** from the Start menu. A tray icon appears; closing the window keeps it running in the tray (*Exit Afuufow* in the tray menu or sidebar quits).

## 2. First-run wizard
1. **Welcome** — pick the interface language. Read the boundaries (it only runs after sign-in; it is not a Windows credential).
2. **Identity** — full name, greeting name, nickname. Preview of the exact greeting.
3. **Services** — for natural Somali you need an **Azure Speech key** (see [costs](HARDWARE_AND_COSTS.md)): paste key and region, tick the cloud boxes you accept, press the *Test* buttons. For AI chat install **Ollama** and run `ollama pull gemma3:4b`, or allow a cloud model.
4. **Models** — download *Silero VAD* and the *wake-word* model (≈20 MB, SHA-256 verified). Optional: speaker model (voice recognition), Whisper small (offline English).
5. **Voice** — enable the wake word; press *Calibrate* and say "Afuufow" three times so the spellings your microphone produces are learned.
6. **Face** (optional) — start enrollment; follow the hints (look straight, turn slightly left/right, change the lighting) until 10 samples are accepted.
7. **Your voice** (optional) — six phrases. Voice never authorises sensitive actions.
8. **Permissions** — set a **PIN**, approve Downloads/Documents/Desktop, decide on visitor questions.
9. **Integrations** — enable WhatsApp Web and scan the QR code once; choose where YouTube plays.
10. **Finish** — start with Windows, turn on listening/camera now or later.

## 3. Contacts for WhatsApp
*Owner & Memory → Approved contacts*: name, aliases (e.g. "Axmed"), number in international form without `+` (e.g. 252611234567), tick *May receive messages*. Messages are only ever sent to approved contacts.

## 4. Everyday commands
| Say / type | Result |
|---|---|
| "Afuufow, Chrome fur" · "Downloads-ka fur" | opens the app / folder |
| "Ii raadi file-ka invoice-ka" | searches approved folders |
| "Google-ka ka raadi cimilada" | web search |
| "Gal YouTube oo ii shid heesta …" · "Ii shid muuqaal ku saabsan …" | plays in the Afuufow player; verified |
| "Jooji muuqaalka" · "Sii wad" · "Codka hoos u dhig" | pause · resume · volume |
| "Ahmed u dir fariintan: …" | sends (explicit) |
| "Ahmed u qor: …" | prepares the text and asks "Ma dirayaa?" (or sends if fast-send applies) |
| "…, ha dirin" / "Fariinta diyaari, ha dirin" | draft only |
| "…, ii akhri ka hor intaadan dirin" | reads it back, then asks |
| "Ii qor email English ah" | drafts and copies to the clipboard; "ku dheji" pastes |
| "Shaashadda akhri" · "Screenshot qaad" | reads the screen / saves a screenshot |
| "Jooji" · "Sug" · "Aamus" | stop speech and tasks immediately (also Ctrl+Alt+Esc) |
| "Fariiso" | "Waan fadhiistay Boss. Maxaan qabtaa? Shaqo ii dir." |

Push-to-talk: **Ctrl+Alt+Space** (press to start, press again to send). Text box on the Home screen always works.

## 5. When it is not sure
It asks a short question (which Ahmed? which video?), says when it could not verify an action ("waan bilaabay, laakiin ma arko daaqaddiisa"), and never sends to an unknown recipient.

## 6. Troubleshooting
*Troubleshooting → Run checks* tests microphone, camera, permissions, keys, internet, Ollama, models and WhatsApp, and explains each fix. Logs: *Open log folder*.
