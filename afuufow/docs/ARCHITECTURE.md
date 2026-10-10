# Architecture

## Stack and why

| Layer | Choice | Why |
|---|---|---|
| App shell | **Electron 44 + TypeScript** | One language for UI, runtime and tests; Chromium gives microphone, camera, audio playback, WebGL and `getUserMedia` echo cancellation with no native camera/audio code; tray, global shortcuts, `powerMonitor`, DPAPI (`safeStorage`) and NSIS packaging are first-class. |
| UI | React 19 + Vite | Maintainable screens, hot reload, small bundle. |
| On-device ML | **sherpa-onnx** (Node addon, ONNX Runtime) in an Electron *utility process* | One native dependency with prebuilt Windows binaries covers voice-activity detection, keyword spotting, offline Whisper and speaker embeddings. Isolated so a model crash cannot take the app down. |
| Face recognition | `@vladmandic/human` (TensorFlow.js, MIT) in a hidden renderer | Detector + descriptor + anti-spoof/liveness models ship inside the package; WebGL with WASM fallback; no Python to bundle. |
| Windows automation | Windows PowerShell 5.1 scripts + Electron APIs | Present on every Windows 10/11, no extra runtime. Parameters are passed as base64 JSON (never interpolated into code). |
| Storage | AES-256-GCM encrypted JSON files; key wrapped by DPAPI | No native database module to cross-compile; data volumes are small. |
| Installer | electron-builder → NSIS (per-user) | Standard Windows installer with shortcuts, uninstaller and Add/Remove Programs entry; no administrator rights. |

## Processes

```
┌──────────────────────────── Electron main process (Background assistant runtime) ────────────────────────────┐
│ index.ts  single instance · tray · login item · crash recovery · global shortcuts                             │
│ runtime.ts wires everything:                                                                                  │
│   Assistant (core/assistant)  ← orchestrator: parse → permissions → tools → verify → speak                    │
│   Permissions + AssuranceManager   Memory · Contacts · VisitorLog · ActionLog · Grants (encrypted)            │
│   VoicePipeline (wake word, VAD segments, push-to-talk, barge-in)   SttRouter   SpeechEngine (TTS queue)     │
│   PresenceTracker + visitor flow   WindowsPlatform (PowerShell)   WhatsApp/YouTube drivers                    │
└───────┬──────────────────────────┬──────────────────────────┬─────────────────────────┬─────────────────────┘
        │ IPC (typed)              │ MessagePort/IPC           │ IPC                     │ IPC
 ┌──────▼──────┐          ┌────────▼────────┐        ┌────────▼────────┐       ┌────────▼────────┐
 │ UI renderer │          │ audio worker     │        │ vision worker    │       │ ML utility proc │
 │ React        │          │ hidden window    │        │ hidden window    │       │ sherpa-onnx     │
 │ (no device   │          │ mic → 16 kHz PCM │        │ camera → Human   │       │ VAD · KWS · ASR │
 │  access)     │          │ speaker playback │        │ → similarity     │       │ speaker embed   │
 └─────────────┘          └─────────────────┘        └─────────────────┘       └─────────────────┘
```

* The UI window has **no** device permission; the hidden workers are the only code that touches the microphone, camera and speaker, and they accept messages only on `audio:*` / `vision:*` channels.
* Closing the UI hides it; the runtime keeps going. If the UI renderer crashes it is recreated; if the ML process exits it is restarted with back-off; unexpected exceptions are logged and, after repeated failures, the app relaunches.

## Component map (source)

| Requirement | Code |
|---|---|
| Desktop interface | `src/renderer/**` |
| Background assistant runtime | `src/main/runtime.ts`, `src/main/index.ts`, `src/main/windows.ts` |
| Wake word | `src/core/speech/wake.ts`, `pipeline.ts`, `src/ml/engine.ts` (KWS) |
| Speech recognition | `src/core/speech/stt/*` (Azure, OpenAI-compatible, local) |
| Speech synthesis | `src/core/speech/tts/*` (Azure neural Somali male voice, Windows SAPI English) |
| AI reasoning | `src/core/llm/*` (Ollama, OpenAI-compatible, Anthropic), `planner.ts` |
| Action execution | `src/core/tools/*`, `src/main/windows/*` |
| Face recognition | `src/core/vision/*`, `src/workers/vision.ts` |
| Optional speaker recognition | `src/core/voiceid/*`, `src/ml/engine.ts` |
| Persistent memory | `src/core/memory/*`, `src/core/storage/*` |
| Visitor event logging | `src/core/visitors/*` |
| Permissions and authentication | `src/core/permissions/*` |

`src/core` has **no Electron and no Windows dependency**: everything security-relevant (permissions, recipient resolution, cancellation, memory, visitor logging) is unit-tested on any OS.

## Command flow

1. Audio → VAD segment → wake word (KWS, or local Whisper in English mode on short segments) → command segment.
2. Speech-to-text (Azure `so-SO` by default). Self-speech filter drops the assistant's own voice; a non-owner voice is ignored when speaker recognition is enabled.
3. `parseCommand` (deterministic Somali/English grammar). Unmatched requests go to the AI planner (JSON plan limited to registered tools) or to streaming chat.
4. Each tool call is checked by `decide()` → *allow*, *confirm*, *needs identity step-up*, or *deny*.
5. The tool runs under an `AbortSignal` (cancel button, "Jooji", timeout) and returns `verified`, `unverified`, `failed`, `cancelled`, `needs_input` or `denied`. Only `verified` results are announced as done.
6. The reply is spoken sentence by sentence while the next sentence is synthesised (LLM stream → sentence chunker → TTS prefetch).

## Permissions model

* Tool risk classes: `routine`, `messaging`, `private`, `sensitive`, `forbidden`.
* Assurance levels: `none < voice < presence < strong`. A voice match gives only `voice`. The camera gives `presence` (with liveness check). Windows Hello / owner PIN gives `strong`.
* `sensitive` = strong + explicit yes, never covered by standing permissions. `private` needs `presence` and no other person visible (or the owner asks aloud). `forbidden` (payments, security changes, arbitrary shell) is always denied and recorded.
* An unrecognised person in front of the camera blocks all voice and typed commands until the owner is verified.
* Prompt-injection guard: once outside content (screen text, web page, message) enters a task, any later side-effect step needs the owner's explicit yes. The AI planner cannot call messaging tools at all.
