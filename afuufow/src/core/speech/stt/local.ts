import { type SttProvider, type SttResult, SttError } from './types';

/** On-device recognition through the ML worker (sherpa-onnx Whisper). Works offline; Somali accuracy is limited, see docs/SPEECH_EVALUATION.md. */
export interface LocalAsrBackend {
  ready(): boolean;
  transcribe(pcm: Int16Array, language: string, signal?: AbortSignal): Promise<{ text: string; ms: number }>;
  modelName(): string;
}

export class LocalSttProvider implements SttProvider {
  readonly id = 'local' as const;
  readonly isCloud = false;
  constructor(private backend: LocalAsrBackend) {}

  async transcribe(pcm: Int16Array, opts: { signal?: AbortSignal; language?: string } = {}): Promise<SttResult> {
    if (!this.backend.ready()) throw new SttError('local speech model is not installed', 'unavailable');
    const lang = (opts.language ?? 'so').split('-')[0]!;
    const r = await this.backend.transcribe(pcm, lang, opts.signal);
    const text = r.text.trim();
    return { text, confidence: null, provider: 'local', language: lang, latencyMs: r.ms, noMatch: text === '' };
  }

  async check() {
    return this.backend.ready() ? { ok: true, detail: `model ${this.backend.modelName()} loaded` } : { ok: false, detail: 'local speech model is not installed (Settings → Integrations → Local speech)' };
  }
}
