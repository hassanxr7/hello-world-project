# Privacy and data

## What is stored, and how
| Data | File | Protection | Retention (default) |
|---|---|---|---|
| Owner names, verified facts, preferences, approved contacts, conversation | `data\memory.afu` | AES-256-GCM, key wrapped by Windows DPAPI | conversation 30 days (0 = none) |
| Action log | `actions.afu` | same | 90 days |
| Visitor events, Windows session events, optional snapshots/audio | `visitors.afu`, `visitor-media\` | same | 180 days / snapshots 30 days |
| Face templates (numbers, not pictures) | `faces.afu` | same | until you delete them |
| Voice templates (numbers) | `voice.afu` | same | until you delete them |
| Standing permissions | `grants.afu` | same | until revoked |
| API keys | `secrets.json` | each value encrypted with DPAPI | until you remove them |
| Owner PIN | in `secrets.json` | scrypt hash with random salt | |
| Preferences (theme, thresholds…) | `settings.json` | none (contains no personal data or secrets) | |

Never stored: camera video, camera frames (except one still image for a visitor **if** you enabled and disclosed it), microphone audio (except a visitor reply if you enabled and disclosed it), API keys in logs or config.

## What leaves this computer
Only what you switch on under *Privacy & Data* (all off by default):
* **Cloud speech recognition** → your voice goes to Microsoft (Azure) or the OpenAI-compatible endpoint you configured.
* **Cloud speech synthesis** → the text to be spoken goes to Microsoft.
* **Cloud AI** → your questions (and, only if you allow it, screen text) go to the provider.
* **Cloud wake word** (off; strongly discouraged) → all nearby speech goes to the recogniser.
Camera frames, face templates, voice templates, memory and visitor data are never uploaded.

* **AI hands:** hand tracking runs inside the camera worker on this PC; only 21 landmark numbers per hand reach the window, they are drawn and discarded. No hand picture is stored or sent anywhere.

## Controls
Pause the microphone/camera instantly (top bar, tray menu); retention periods; export (memory, visitors, action log) and delete (individual items or *Delete all my data*); revoke standing permissions; delete face/voice templates. The camera and microphone workers release the devices the moment you pause (Windows' own camera/microphone indicators go off).

## Unknown people
When enabled, an unrecognised face triggers the fixed Somali questions. The consent notice is spoken **before** listening starts. Nothing the person says is stored if they decline, stay silent, or you return mid-conversation. Name and explanation are stored as **self-reported, unverified**. Camera observations and Windows sign-in/unlock events are kept in separate lists; the app never claims the person unlocked the laptop. Visitors never gain access to memory, chats, files or actions.

## Honest limits
Face and voice recognition are for personalisation and presence. They are not Windows authentication and they are not enough for sensitive actions (PIN or Windows Hello is required). The anti-photo check rejects a still photo but not a replayed video or a deepfake. Windows' lock screen, credential providers and sign-in cannot be monitored or replaced by an ordinary desktop program, and Afuufow starts only **after** you sign in.
