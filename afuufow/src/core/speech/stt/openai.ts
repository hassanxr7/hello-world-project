import { pcmToWav } from '../audio';
import { type SttProvider, type SttResult, SttError } from './types';
import { wrapNetwork } from './azure';

/** OpenAI-compatible /audio/transcriptions (OpenAI, Groq, or a local whisper server). */
export class OpenAISttProvider implements SttProvider {
  readonly id = 'openai' as const;
  readonly isCloud: boolean;
  constructor(
    private baseUrl: string,
    private model: string,
    private getKey: () => string | null,
    private fetchFn: typeof fetch = fetch,
  ) {
    this.isCloud = !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(baseUrl);
  }

  async transcribe(pcm: Int16Array, opts: { signal?: AbortSignal; language?: string; prompt?: string } = {}): Promise<SttResult> {
    const t0 = Date.now();
    const lang = (opts.language ?? 'so').split('-')[0]!;
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(pcmToWav(pcm))], { type: 'audio/wav' }), 'speech.wav');
    form.set('model', this.model);
    form.set('language', lang);
    form.set('response_format', 'json');
    form.set('temperature', '0');
    if (opts.prompt) form.set('prompt', opts.prompt);
    const key = this.getKey();
    try {
      const res = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
        method: 'POST',
        headers: key ? { authorization: `Bearer ${key}` } : {},
        body: form,
        signal: opts.signal,
      });
      if (res.status === 401 || res.status === 403) throw new SttError(`speech API rejected the key (HTTP ${res.status})`, 'auth');
      if (res.status === 429) throw new SttError('speech API rate limit', 'quota');
      if (!res.ok) throw new SttError(`speech API HTTP ${res.status}`, 'other');
      const j = (await res.json()) as { text?: string };
      const text = (j.text ?? '').trim();
      return { text, confidence: null, provider: 'openai', language: lang, latencyMs: Date.now() - t0, noMatch: text === '' };
    } catch (e) {
      throw wrapNetwork(e);
    }
  }

  async check(signal?: AbortSignal) {
    try {
      const key = this.getKey();
      const res = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: signal ?? AbortSignal.timeout(8000) });
      return res.ok ? { ok: true, detail: 'reachable' } : { ok: false, detail: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
