# Third-party notices

Afuufow is MIT-licensed (see `LICENSE`). It bundles or downloads the following. Each keeps its own licence; their texts ship inside the installed packages.

| Component | Licence | Use |
|---|---|---|
| Electron, Chromium | MIT / BSD-style (see `LICENSES.chromium.html` in the install folder) | application shell |
| React, ReactDOM | MIT | UI |
| zod | MIT | validation |
| `@vladmandic/human` (face detector, descriptor, anti-spoof, liveness models) | MIT, © Vladimir Mandic | face recognition; its descriptor-similarity formula is re-implemented in `src/core/vision/similarity.ts` |
| TensorFlow.js | Apache-2.0 | runs the face models |
| sherpa-onnx, ONNX Runtime | Apache-2.0 / MIT | on-device ML runtime |
| Silero VAD | MIT | voice-activity detection (downloaded on request) |
| Keyword-spotting model `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01` | Apache-2.0 | wake word (downloaded on request) |
| WeSpeaker ResNet34 speaker model | Apache-2.0 | optional voice recognition (downloaded on request) |
| OpenAI Whisper weights (sherpa-onnx conversions) | MIT | optional English/offline recognition (downloaded on request) |
| Google FLEURS | CC-BY-4.0 | evaluation data (not shipped) |
| electron-builder / NSIS | MIT / zlib | installer |
| **Open Interpreter** (`openinterpreter/openinterpreter`, release `rust-v0.0.56`; a fork of OpenAI Codex, which includes code derived from Ratatui, MIT) | **Apache-2.0** (`LICENSE`; copyright notice in its `NOTICE`, kept in `docs/licenses/OPEN_INTERPRETER_NOTICE.txt`) | optional task agent. Not bundled or modified: Afuufow downloads the official release on request (pinned SHA-256) and runs it as a separate process over ACP; see `docs/INTERPRETER.md` |

Ideas (not code) from Maya AI 1.2 by Taha: see `docs/REFERENCE_MAYA.md`.
Model licences should be re-checked at the download sources before redistribution.
