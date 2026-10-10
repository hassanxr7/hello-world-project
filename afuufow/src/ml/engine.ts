/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * On-device ML (sherpa-onnx): voice activity detection, offline Whisper, keyword spotting, speaker embeddings.
 * No audio ever leaves this process unless the caller sends it to a cloud provider.
 * Loaded lazily so the app still starts when models are not installed.
 */

export type WhisperSize = 'tiny' | 'base' | 'small' | 'medium';

export interface Segment {
  samples: Float32Array;
  /** start offset in samples since the VAD was (re)created */
  start: number;
}

export interface MlCaps {
  vad: boolean;
  asr: WhisperSize | null;
  kws: boolean;
  speaker: boolean;
}

export class MlEngine {
  private sherpa: any;
  private vad: any = null;
  private asr: any = null;
  private asrSize: WhisperSize | null = null;
  private asrLang = '';
  private kws: any = null;
  private kwsStream: any = null;
  private spk: any = null;

  constructor(sherpaModule?: unknown) {
    this.sherpa = sherpaModule ?? require('sherpa-onnx-node');
  }

  caps(): MlCaps {
    return { vad: !!this.vad, asr: this.asr ? this.asrSize : null, kws: !!this.kws, speaker: !!this.spk };
  }

  // ---------------------------------------------------------------- VAD
  loadVad(modelPath: string, opts: { threshold?: number; minSilence?: number; minSpeech?: number; maxSpeech?: number } = {}) {
    if (!fs.existsSync(modelPath)) throw new Error(`VAD model not found: ${modelPath}`);
    this.vad = new this.sherpa.Vad(
      {
        sileroVad: {
          model: modelPath,
          threshold: opts.threshold ?? 0.5,
          minSpeechDuration: opts.minSpeech ?? 0.25,
          minSilenceDuration: opts.minSilence ?? 0.7,
          maxSpeechDuration: opts.maxSpeech ?? 25,
          windowSize: 512,
        },
        sampleRate: 16000,
        debug: false,
        numThreads: 1,
      },
      30,
    );
  }

  /** Feed audio; returns every speech segment that just ended. */
  vadAccept(samples: Float32Array): Segment[] {
    if (!this.vad) return [];
    this.vad.acceptWaveform(samples);
    const out: Segment[] = [];
    while (!this.vad.isEmpty()) {
      const s = this.vad.front(false);
      this.vad.pop();
      out.push({ samples: Float32Array.from(s.samples), start: s.start });
    }
    return out;
  }
  vadSpeaking(): boolean {
    return this.vad ? !!this.vad.isDetected() : false;
  }
  vadReset() {
    this.vad?.reset?.();
    this.vad?.clear?.();
  }

  // ---------------------------------------------------------------- ASR (Whisper)
  loadWhisper(modelsDir: string, size: WhisperSize, threads = 2) {
    const dir = path.join(modelsDir, `whisper-${size}`);
    const enc = path.join(dir, `${size}-encoder.int8.onnx`);
    const dec = path.join(dir, `${size}-decoder.int8.onnx`);
    const tok = path.join(dir, `${size}-tokens.txt`);
    for (const f of [enc, dec, tok]) if (!fs.existsSync(f)) throw new Error(`Whisper file missing: ${f}`);
    this.asrSize = size;
    this.asrThreads = threads;
    this.asrPaths = { enc, dec, tok };
    this.asr = null;
    this.asrLang = '';
    this.ensureAsr('so');
  }
  private asrThreads = 2;
  private asrPaths: { enc: string; dec: string; tok: string } | null = null;

  private ensureAsr(language: string) {
    if (!this.asrPaths) throw new Error('local speech model is not installed');
    if (this.asr && this.asrLang === language) return;
    this.asr = new this.sherpa.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        whisper: { encoder: this.asrPaths.enc, decoder: this.asrPaths.dec, language, task: 'transcribe', tailPaddings: -1 },
        tokens: this.asrPaths.tok,
        numThreads: this.asrThreads,
        provider: 'cpu',
        debug: 0,
      },
    });
    this.asrLang = language;
  }

  transcribe(samples: Float32Array, language: string): { text: string; ms: number } {
    this.ensureAsr(language);
    const t0 = Date.now();
    const stream = this.asr.createStream();
    stream.acceptWaveform({ samples, sampleRate: 16000 });
    this.asr.decode(stream);
    const r = this.asr.getResult(stream);
    return { text: String(r.text ?? '').trim(), ms: Date.now() - t0 };
  }

  // ---------------------------------------------------------------- keyword spotting
  loadKws(modelDir: string, keywordsFile: string, opts: { threshold?: number; score?: number } = {}) {
    const f = (n: string) => path.join(modelDir, n);
    const pick = (a: string, b: string) => (fs.existsSync(f(a)) ? f(a) : f(b));
    this.kws = new this.sherpa.KeywordSpotter({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: pick('encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx', 'encoder-epoch-12-avg-2-chunk-16-left-64.onnx'),
          decoder: pick('decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx', 'decoder-epoch-12-avg-2-chunk-16-left-64.onnx'),
          joiner: pick('joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx', 'joiner-epoch-12-avg-2-chunk-16-left-64.onnx'),
        },
        tokens: f('tokens.txt'),
        numThreads: 1,
        provider: 'cpu',
        debug: 0,
      },
      maxActivePaths: 4,
      numTrailingBlanks: 1,
      keywordsScore: opts.score ?? 1.0,
      keywordsThreshold: opts.threshold ?? 0.25,
      keywordsFile,
    });
    this.kwsStream = this.kws.createStream();
  }

  /** Returns the detected keyword text, or null. */
  kwsAccept(samples: Float32Array): string | null {
    if (!this.kws) return null;
    this.kwsStream.acceptWaveform({ samples, sampleRate: 16000 });
    let hit: string | null = null;
    while (this.kws.isReady(this.kwsStream)) {
      this.kws.decode(this.kwsStream);
      const r = this.kws.getResult(this.kwsStream);
      if (r.keyword) {
        hit = r.keyword;
        this.kws.reset(this.kwsStream);
      }
    }
    return hit;
  }

  // ---------------------------------------------------------------- speaker embeddings
  loadSpeaker(modelPath: string) {
    if (!fs.existsSync(modelPath)) throw new Error(`speaker model not found: ${modelPath}`);
    this.spk = new this.sherpa.SpeakerEmbeddingExtractor({ model: modelPath, numThreads: 1, debug: 0, provider: 'cpu' });
  }
  embed(samples: Float32Array): Float32Array {
    if (!this.spk) throw new Error('speaker model is not installed');
    const s = this.spk.createStream();
    s.acceptWaveform({ samples, sampleRate: 16000 });
    s.inputFinished?.();
    return Float32Array.from(this.spk.compute(s));
  }
  embeddingDim(): number {
    return this.spk?.dim ?? 0;
  }
}
