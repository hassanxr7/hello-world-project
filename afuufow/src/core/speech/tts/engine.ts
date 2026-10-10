import type { Settings } from '../../config/settings';
import type { SpeechOut } from '../../assistant/types';
import { AbortError } from '../../util';
import { type AudioClip, type AudioPlayer, type TtsProvider, TtsError } from './types';

interface Item {
  text: string;
  lang: 'so' | 'en';
  signal?: AbortSignal;
  resolve: () => void;
  reject: (e: Error) => void;
  clip?: Promise<AudioClip>;
  done: boolean;
}

export interface SpeechMetrics {
  provider: string;
  chars: number;
  synthMs: number;
  cached: boolean;
}

/**
 * Sentence-level streaming speech: while sentence N plays, sentence N+1 is already being synthesised.
 * Falls back to the next provider that supports the language; refuses cloud synthesis when the owner disabled it.
 */
export class SpeechEngine implements SpeechOut {
  private queue: Item[] = [];
  private running = false;
  private cache = new Map<string, AudioClip>();
  private stopToken = 0;
  /** Increments on every stop(): lets a caller detect that its utterance was cut off. */
  get epoch() {
    return this.stopToken;
  }

  constructor(
    private settings: () => Settings,
    private providers: () => Partial<Record<'azure' | 'sapi', TtsProvider>>,
    private player: AudioPlayer,
    private onMetric?: (m: SpeechMetrics) => void,
    private persist?: { get(key: string): Promise<Buffer | null>; put(key: string, data: Buffer): Promise<void> },
  ) {}

  private chain(): TtsProvider[] {
    const s = this.settings().providers.tts;
    const p = this.providers();
    return [p[s.primary], s.fallback !== 'none' ? p[s.fallback] : undefined].filter((x): x is TtsProvider => !!x);
  }

  private key(provider: TtsProvider, text: string, lang: string) {
    const t = this.settings().providers.tts;
    return `${provider.id}|${t.azureVoice}|${lang}|${t.rate}|${text}`;
  }

  async synthesise(text: string, lang: 'so' | 'en', signal?: AbortSignal): Promise<AudioClip> {
    const s = this.settings();
    let lastErr: Error | null = null;
    for (const p of this.chain()) {
      if (!p.supports(lang)) {
        lastErr ??= new TtsError(`${p.id} does not support ${lang}`, 'unsupported_language');
        continue;
      }
      const k = this.key(p, text, lang);
      const hit = this.cache.get(k);
      if (hit) {
        this.onMetric?.({ provider: p.id, chars: text.length, synthMs: 0, cached: true });
        return hit;
      }
      const disk = text.length <= 120 ? await this.persist?.get(this.hashKey(k)).catch(() => null) : null;
      if (disk) {
        const clip: AudioClip = { data: disk, mime: disk.subarray(0, 4).toString() === 'RIFF' ? 'audio/wav' : 'audio/mpeg' };
        this.cache.set(k, clip);
        this.onMetric?.({ provider: p.id, chars: text.length, synthMs: 0, cached: true });
        return clip;
      }
      if (p.isCloud && !s.privacy.allowCloudTts) {
        lastErr = new TtsError('cloud speech synthesis is disabled in privacy settings', 'cloud_disabled');
        continue;
      }
      const t0 = Date.now();
      try {
        const clip = await p.synth(text, lang, signal);
        this.onMetric?.({ provider: p.id, chars: text.length, synthMs: Date.now() - t0, cached: false });
        if (text.length <= 200) {
          this.cache.set(k, clip);
          if (this.cache.size > 80) this.cache.delete(this.cache.keys().next().value!);
          if (text.length <= 120) void this.persist?.put(this.hashKey(k), clip.data).catch(() => undefined);
        }
        return clip;
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        lastErr = e as Error;
      }
    }
    throw lastErr ?? new TtsError('no speech synthesis provider is configured', 'unavailable');
  }

  private hashKey(k: string): string {
    let h = 5381;
    for (let i = 0; i < k.length; i++) h = ((h << 5) + h + k.charCodeAt(i)) | 0;
    return 'tts_' + (h >>> 0).toString(16) + '_' + k.length;
  }

  speak(text: string, signal?: AbortSignal, lang: 'so' | 'en' = 'so'): Promise<void> {
    const t = text.trim();
    if (!t) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const item: Item = { text: t, lang, signal, resolve, reject, done: false };
      if (signal?.aborted) return resolve();
      signal?.addEventListener('abort', () => this.cancelItem(item), { once: true });
      this.queue.push(item);
      this.prefetch();
      void this.run();
    });
  }

  private cancelItem(item: Item) {
    if (item.done) return;
    item.done = true;
    this.queue = this.queue.filter((i) => i !== item);
    item.resolve();
    if (this.current === item) this.player.stop();
  }

  private current: Item | null = null;

  private prefetch() {
    for (const item of this.queue.slice(0, 2)) {
      if (!item.clip) {
        item.clip = this.synthesise(item.text, item.lang, item.signal);
        item.clip.catch(() => undefined);
      }
    }
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    const token = this.stopToken;
    try {
      while (this.queue.length > 0 && token === this.stopToken) {
        const item = this.queue.shift()!;
        if (item.done) continue;
        this.current = item;
        this.prefetch();
        try {
          const clip = await (item.clip ?? this.synthesise(item.text, item.lang, item.signal));
          if (!item.done && token === this.stopToken) await this.player.play(clip, item.signal);
          item.done = true;
          item.resolve();
        } catch (e) {
          item.done = true;
          if ((e as Error).name === 'AbortError' || e instanceof AbortError) item.resolve();
          else item.reject(e as Error);
        }
        this.current = null;
      }
    } finally {
      this.running = false;
      this.current = null;
      if (this.queue.length > 0) void this.run();
    }
  }

  /** Immediate: stop playback and flush every queued sentence. */
  stop(): void {
    this.stopToken++;
    const pending = this.queue.splice(0);
    this.player.stop();
    for (const i of pending) {
      i.done = true;
      i.resolve();
    }
    if (this.current) {
      this.current.done = true;
      this.current.resolve();
      this.current = null;
    }
  }
}
