# Reference project analysis: Maya AI 1.2

Source inspected: `github.com/shaikhtaha258-maker/Maya-ai-1.2` (shallow clone, commit `1d739fe`). The developer profile page itself was not accessible from this environment (GitHub API access outside the attached repository is blocked); the repository was readable.

## What it actually is
A single 190-line `main.py` plus a GIF viewer, a startup GIF and a 130-line `pip freeze` as `requirements.txt`.

| README claim | What the code does | Verdict |
|---|---|---|
| Voice recognition | `speech_recognition` + `recognize_google(language="en-IN")` (Google web API, **English only**) | Works for English only; no Somali. |
| Wake word "Maya" | substring match of "maya" in a 3-second recognised phrase, then listens again | Cloud STT runs continuously; no local wake detection. |
| Ollama (Llama 3) | `ollama.chat(model="llama3")` fallback for unknown commands | Implemented (blocking, no streaming). |
| Text-to-speech | `os.system('say "…"')` | **macOS-only**, shell-injectable (`"` only partly escaped). |
| Open apps | `open -a "Google Chrome"` etc. | macOS-only. |
| "Open WhatsApp" | branch tests `"open whatsApp"` after the command was lower-cased | **Never matches** (bug). Only opens the app; no messaging. |
| Folder search | `mdfind` (Spotlight) | macOS-only. |
| Play song / YouTube | `pywhatkit.playonyt`, search URLs (query not URL-encoded) | Works on any OS, unverified. |
| Screenshot | `pyautogui.screenshot` + `open` | `open` is macOS-only. |
| Animation | opens a GIF in a browser at start | Static GIF; not tied to activity. |
| Face recognition, memory, permissions, visitor features | not present | n/a |
| `requirements.txt` | includes `pyobjc-*`, streamlit, mediapipe, matplotlib… not used by `main.py` | macOS-specific, mostly unused. |

## License
The README says "licensed under the MIT License", but the repository contains **no `LICENSE` file**, so no copyright notice or grant text exists to preserve or verify. To stay safe, **no code or assets (including the GIF) were copied**. Afuufow is an independent implementation; only general ideas were taken (Ollama fallback for open questions, wake word + command loop, YouTube search/play, screenshot, folder opening, a startup animation), each re-designed for Windows with permissions, verification and tests. Credit: ideas inspired by Maya AI 1.2 by Taha.
