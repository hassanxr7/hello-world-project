# Speech evaluation (measured, not assumed)

All numbers below were produced by running the code/models in this repository on real Somali audio. Where something could **not** be measured it says so.

## Test data
* **Google FLEURS Somali (`so_so`) test split** (read speech, 16 kHz). 1019 clips, 3.92 hours, **all male speakers**, 350 distinct sentences.
* Whisper models were scored on a **fixed subset: every 25th clip = 41 clips, 500.4 s** (running the 1.9 GB "medium" model on all clips on a 4-core CPU would take many hours).
* Reference text = FLEURS normalised transcript, further normalised (lower-case, punctuation removed). WER can exceed 100% because hallucinated extra words count as errors.
* Machine: 4 CPU cores, no GPU, sherpa-onnx 1.13.8, int8 models, `language="so"`, 4 threads.

## Result 1 — on-device Whisper cannot recognise Somali

| Model | WER | CER | Real-time factor | Mean latency / clip (12 s avg) | Clips with Arabic-script output |
|---|---|---|---|---|---|
| Whisper tiny | not scored; first clips were hallucinations (`Good morning…`, `(Spanish)`) | | | | |
| Whisper base | **109.8 %** | 92.3 % | 0.34 | 4.2 s | 41 / 41 |
| Whisper small | **101.0 %** | 89.6 % | 1.14 | 14.0 s | 41 / 41 |
| Whisper medium | **100.7 %** | 94.0 % | 3.43 | 41.9 s (worst clip 112 s) | 34 / 41 |

The models write phonetic **Arabic script** instead of Somali, and often loop. Acting on such text would be unsafe, so **on-device Somali recognition is disabled** in the product (`LocalSttProvider` refuses `so`). Local Whisper is kept for English and for transcript-style wake-word matching (English mode).

## Result 2 — wake word "Afuufow" (on-device keyword spotter, sherpa-onnx zipformer-gigaspeech 3.3 M)
* **False alarms:** 0 in 46.9 minutes of real Somali speech (FLEURS, every 5th clip) at thresholds 0.15, 0.25 and 0.40. 47 minutes is far too little to claim a per-day rate.
* **Detections:** 10 of 20 **synthetic** "Afuufow" clips (eSpeak-NG English/Swahili/Oromo voices at 4 speed/pitch settings). This is *not* a measurement of real human pronunciation, which could be better or worse; no recordings of the owner saying the word were available. Use *Settings → Calibrate wake word* and push-to-talk, and treat the wake word as best-effort.
* Real-time factor of the spotter ≈ 0.05 (about 5 % of one core).

## Result 3 — cloud providers (Azure `so-SO`, OpenAI-compatible) — **NOT MEASURED HERE**
No Azure or OpenAI key was available, so no accuracy or latency figure for them is claimed. Somali support is listed by Microsoft for speech-to-text and text-to-speech (`so-SO`, voices `so-SO-MuuseNeural` male and `so-SO-UbaxNeural` female), but its quality on *your* voice and microphone is unknown until you measure it:

```powershell
$env:AFUUFOW_AZURE_KEY = '<your key>'
npm run eval:speech -- --manifest C:\data\fleurs_so_test_manifest.jsonl --provider azure --region westeurope --limit 100
```
The manifest is one JSON object per line: `{"wav":"C:\\data\\clip.wav","ref":"reference text"}` (16 kHz mono 16-bit WAV; `ffmpeg -i in.wav -ac 1 -ar 16000 -c:a pcm_s16le out.wav`). FLEURS Somali: `https://storage.googleapis.com/xtreme_translations/FLEURS102/so_so.tar.gz`. For commands, record your own 50–100 Somali and mixed Somali–English commands in your normal room and score those; they matter more than read sentences. The script prints WER/CER, exact-match rate and p50/p95 latency and writes a result JSON. Failed requests count as 100 % errors.

## What the product does about uncertainty
* Low-confidence or empty recognition → short Somali clarification or no action; ambiguous contacts/apps/songs → a question; nothing is sent to an uncertain recipient.
* Pronunciation variants: names and apps are matched phonetically (Axmed≈Ahmed, Cabdi≈Abdi); the wake word accepts spelling variants plus spellings learned in calibration.
* Streaming: AI text streams into the speech engine sentence by sentence (the next sentence is synthesised while the current one plays). Speech-to-text is **not** streamed: audio is sent after the VAD detects the end of the utterance.
* Latency of the TTS path is logged per sentence (`logs\afuufow.log`: provider, characters, milliseconds, cached or not).

## Reproduce the Whisper/wake-word runs
The scripts used are described in this file; data sources are public. The model files were downloaded from the `k2-fsa/sherpa-onnx` GitHub releases (`asr-models`, `kws-models`) and their SHA-256 values are pinned in `src/main/models.ts`.
