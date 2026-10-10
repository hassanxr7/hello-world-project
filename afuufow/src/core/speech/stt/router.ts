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
        const err = e instanceof SttError ? e : new SttError((e as Error).message, 'other');
        errors.push(`${p.id}: ${err.message}`);
        // a fallback saying "unavailable" must not hide why the primary provider was skipped or failed
        if (!(lastErr && err.kind === 'unavailable')) lastErr = err;
      }
    }
    throw lastErr ?? new SttError('no speech recognition provider is configured', 'unavailable');
  }
}

export function sttErrorMessage(e: unknown): { so: string; en: string } {
  const k = e instanceof SttError ? e.kind : 'other';
  switch (k) {
    case 'auth': {
      const missing = e instanceof Error && /not set/i.test(e.message);
      return missing
        ? { so: 'Furaha Azure Speech weli lama gelin (Settings → Isku-xirka).', en: 'The Azure Speech key is not set yet (Settings → Integrations).' }
        : { so: 'Azure wuu diiday furaha. Hubi in furaha (KEY 1) iyo REGION-ka (tusaale westeurope) ay isku resource yihiin.', en: 'Azure rejected the key. Check that the key (KEY 1) and the region (e.g. westeurope) belong to the same Speech resource.' };
    }
    case 'network': return { so: 'Internetka ma shaqeynayo; ma fahmi karo codka hadda.', en: 'No internet connection; speech recognition is unavailable right now.' };
    case 'quota': return { so: 'Xadka adeegga codka waa dhammaaday.', en: 'The speech service quota or rate limit was reached.' };
    case 'cloud_disabled': return { so: 'Aqoonsiga codka ee cloud-ka waa la xiray (Privacy).', en: 'Cloud speech recognition is turned off in Privacy settings.' };
    case 'unavailable': return { so: 'Soomaaliga ma fahmi karo iyada oo aan internet/cloud la isticmaalin (moodelka maxaliga ah aad buu u liita).', en: 'Somali needs the cloud recognizer (or the local model is missing); on-device Somali recognition is disabled because it measured unusable.' };
    default: return { so: 'Codka ma fahmin.', en: 'Speech recognition failed.' };
  }
}
