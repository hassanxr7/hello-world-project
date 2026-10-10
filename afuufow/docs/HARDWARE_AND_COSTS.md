# Hardware requirements, internet dependencies and costs

## Minimum / recommended

| | Minimum | Recommended |
|---|---|---|
| OS | Windows 10 version 1809 x64 or Windows 11 | Windows 11 |
| CPU | 4 cores | 6+ cores (needed for a local Ollama model) |
| RAM | 8 GB | 16 GB (local AI model + browser) |
| Disk | 1 GB (app ≈ 0.5 GB, wake-word + VAD models ≈ 20 MB) | 8 GB if you also use a local Ollama model |
| Microphone | any (headset recommended) | headset or array microphone |
| Camera | 720p webcam (only for face features) | 720p+ with decent low-light behaviour |
| GPU | not required | integrated GPU is enough for the face model (WebGL; WASM fallback is slower) |

## What needs the internet

| Capability | Online? | Notes |
|---|---|---|
| Somali speech recognition | **Yes** (Azure Speech `so-SO`, or an OpenAI-compatible endpoint) | On-device Somali recognition was measured unusable and is disabled. |
| Somali voice (male) | **Yes** (Azure neural voice `so-SO-MuuseNeural`) | Common phrases are cached after first use. Windows has no offline Somali voice. |
| English voice | No (Windows SAPI) | |
| Wake word "Afuufow" | No (on-device keyword model) | |
| Face / voice recognition | No | |
| AI chat / planning | No with Ollama; Yes for cloud models | Small local models speak Somali only moderately. |
| Open apps/folders, files, screenshots, volume | No | |
| YouTube / WhatsApp Web / web search | Yes | |

## Ollama (local AI)
Install from <https://ollama.com>, then `ollama pull gemma3:4b` (≈3 GB download, ≈6 GB RAM while running). Larger models answer better and need proportionally more RAM. Ollama is free; models carry their own licences.

## External service costs (check current prices before relying on them)
* **Azure AI Speech** — recognition and neural voices are billed per audio hour / per million characters, with a monthly free tier at the time of writing. Create a *Speech* resource in the Azure portal, copy **Key 1** and the **region**. <https://azure.microsoft.com/pricing/details/cognitive-services/speech-services/>
* **Cloud AI (optional)** — Anthropic or any OpenAI-compatible API: billed per token by the provider.
* **YouTube Data API (optional)** — free quota; without a key the app parses the public search page instead.
* **WhatsApp Web** — free; see the terms-of-service warning in the README.

The app itself has no subscription and never contacts any server of its own.
