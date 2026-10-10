import type { Settings } from '../../config/settings';
import { type SttProvider, type SttResult, SttError } from './types';

/** Picks the primary provider, falls back on failure, and enforces the owner's cloud privacy switch. */
export class SttRouter {
  constructor(
    private settings: () => Settings,
    private providers: () => Partial<Record<'azure' | 'openai' | 'local', SttProvider>>,
  ) {}

  private order(): SttProvider[] {
    const s = this.settings().providers.stt;
    const p = this.providers();
    const list = [p[s.primary], s.fallback !== 'none' ? p[s.fallback] : undefined].filter((x): x is SttProvider => !!x);
    return list.filter((x, i, a) => a.indexOf(x) === i);
  }

  async transcribe(pcm: Int16Array, opts: { signal?: AbortSignal; prompt?: string } = {}): Promise<SttResult> {
    const s = this.settings();
    const errors: string[] = [];
    let lastErr: SttError | null = null;
    for (const p of this.order()) {
      if (p.isCloud && !s.privacy.allowCloudStt) {
        lastErr = new SttError('cloud speech recognition is disabled in privacy settings', 'cloud_disabled');
        errors.push(`${p.id}: disabled in privacy settings`);
        continue;
      }
      try {
        const lang = p.id === 'azure' ? s.providers.stt.azureLanguage : s.general.speechLanguage;
        const r = await p.transcribe(pcm, { signal: opts.signal, language: lang, prompt: opts.prompt });
        return r;
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        lastErr = e instanceof SttError ? e : new SttError((e as Error).message, 'other');
        errors.push(`${p.id}: ${lastErr.message}`);
      }
    }
    throw lastErr ?? new SttError('no speech recognition provider is configured', 'unavailable');
  }

  /** Streaming-capable primary provider (if any), honouring the privacy switch. */
  streamingProvider(): SttProvider | null {
    const s = this.settings();
    const p = this.providers()[s.providers.stt.primary];
    if (!p?.openStream) return null;
    if (p.isCloud && !s.privacy.allowCloudStt) return null;
    return p;
  }
}

export function sttErrorMessage(e: unknown): { so: string; en: string } {
  const k = e instanceof SttError ? e.kind : 'other';
  switch (k) {
    case 'auth': return { so: 'Furaha adeegga codka waa khaldan yahay; hubi Settings.', en: 'The speech service key was rejected; check Settings.' };
    case 'network': return { so: 'Internetka ma shaqeynayo; ma fahmi karo codka hadda.', en: 'No internet connection; speech recognition is unavailable right now.' };
    case 'quota': return { so: 'Xadka adeegga codka waa dhammaaday.', en: 'The speech service quota or rate limit was reached.' };
    case 'cloud_disabled': return { so: 'Aqoonsiga codka ee cloud-ka waa la xiray (Privacy).', en: 'Cloud speech recognition is turned off in Privacy settings.' };
    case 'unavailable': return { so: 'Moodelka codka maxaliga ah lama rakibin.', en: 'The local speech model is not installed.' };
    default: return { so: 'Codka ma fahmin.', en: 'Speech recognition failed.' };
  }
}
