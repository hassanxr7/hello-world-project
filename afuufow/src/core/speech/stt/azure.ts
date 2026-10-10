import { pcmToWav } from '../audio';
import { type SttProvider, type SttResult, SttError } from './types';

/**
 * Azure AI Speech, REST "short audio" API (<= 60 s per request, so-SO supported by Microsoft's language list).
 * https://learn.microsoft.com/azure/ai-services/speech-service/rest-speech-to-text-short
 */
export class AzureSttProvider implements SttProvider {
  readonly id = 'azure' as const;
  readonly isCloud = true;
  constructor(
    private region: string,
    private getKey: () => string | null,
    private defaultLanguage = 'so-SO',
    private fetchFn: typeof fetch = fetch,
  ) {}

  private url(lang: string) {
    return `https://${this.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(lang)}&format=detailed&profanity=raw`;
  }

  private headers(): Record<string, string> {
    const key = this.getKey();
    if (!key) throw new SttError('Azure Speech key is not set', 'auth');
    return {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
      Accept: 'application/json',
    };
  }

  private async parse(res: Response, lang: string, t0: number): Promise<SttResult> {
    if (res.status === 401 || res.status === 403) throw new SttError(`Azure rejected the key (HTTP ${res.status})`, 'auth');
    if (res.status === 429) throw new SttError('Azure Speech quota/rate limit reached', 'quota');
    if (res.status === 400) throw new SttError('Azure could not read the audio or language', 'bad_audio');
    if (!res.ok) throw new SttError(`Azure Speech HTTP ${res.status}`, 'other');
    const j = (await res.json()) as {
      RecognitionStatus?: string;
      DisplayText?: string;
      NBest?: Array<{ Confidence?: number; Display?: string }>;
    };
    const latencyMs = Date.now() - t0;
    if (j.RecognitionStatus !== 'Success') {
      return { text: '', confidence: null, provider: 'azure', language: lang, latencyMs, noMatch: true };
    }
    const best = j.NBest?.[0];
    return { text: (best?.Display ?? j.DisplayText ?? '').trim(), confidence: best?.Confidence ?? null, provider: 'azure', language: lang, latencyMs };
  }

  async transcribe(pcm: Int16Array, opts: { signal?: AbortSignal; language?: string } = {}): Promise<SttResult> {
    const lang = opts.language ?? this.defaultLanguage;
    const t0 = Date.now();
    try {
      const res = await this.fetchFn(this.url(lang), { method: 'POST', headers: this.headers(), body: new Uint8Array(pcmToWav(pcm)), signal: opts.signal });
      return await this.parse(res, lang, t0);
    } catch (e) {
      throw wrapNetwork(e);
    }
  }

  async check(signal?: AbortSignal) {
    try {
      const key = this.getKey();
      if (!key) return { ok: false, detail: 'Azure Speech key is not set' };
      // one second of silence: a valid request that exercises auth + region + language without needing a microphone
      const silence = new Int16Array(16000);
      const res = await this.fetchFn(this.url(this.defaultLanguage), { method: 'POST', headers: this.headers(), body: new Uint8Array(pcmToWav(silence)), signal: signal ?? AbortSignal.timeout(10_000) });
      if (res.status === 401 || res.status === 403) return { ok: false, detail: `key rejected (HTTP ${res.status}); check key and region "${this.region}"` };
      return res.ok ? { ok: true, detail: `reachable, key accepted, language ${this.defaultLanguage}` } : { ok: false, detail: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}

export function wrapNetwork(e: unknown): Error {
  if (e instanceof SttError) return e;
  const err = e as Error;
  if (err.name === 'AbortError') return err;
  return new SttError(`network error: ${err.message}`, 'network');
}
