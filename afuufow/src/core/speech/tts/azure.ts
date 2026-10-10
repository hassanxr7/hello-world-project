import { type AudioClip, type TtsProvider, TtsError } from './types';

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function buildSsml(text: string, voice: string, lang: string, rate: number): string {
  const pct = Math.round((rate - 1) * 100);
  const prosody = pct === 0 ? escapeXml(text) : `<prosody rate="${pct > 0 ? '+' : ''}${pct}%">${escapeXml(text)}</prosody>`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice xml:lang="${lang}" name="${voice}">${prosody}</voice></speak>`;
}

/**
 * Azure AI Speech neural TTS. Somali male voice: so-SO-MuuseNeural (female: so-SO-UbaxNeural).
 * English fallback voice for non-Somali replies: en-US-GuyNeural (male).
 */
export class AzureTtsProvider implements TtsProvider {
  readonly id = 'azure' as const;
  readonly isCloud = true;
  constructor(
    private region: string,
    private voiceSo: string,
    private getKey: () => string | null,
    private getRate: () => number,
    private voiceEn = 'en-US-GuyNeural',
    private fetchFn: typeof fetch = fetch,
  ) {}

  supports() {
    return true;
  }

  async synth(text: string, lang: 'so' | 'en', signal?: AbortSignal): Promise<AudioClip> {
    const key = this.getKey();
    if (!key) throw new TtsError('Azure Speech key is not set', 'auth');
    const voice = lang === 'so' ? this.voiceSo : this.voiceEn;
    const xmlLang = voice.split('-').slice(0, 2).join('-');
    try {
      const res = await this.fetchFn(`https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
          'User-Agent': 'Afuufow',
        },
        body: buildSsml(text, voice, xmlLang, this.getRate()),
        signal,
      });
      if (res.status === 401 || res.status === 403) throw new TtsError(`Azure rejected the key (HTTP ${res.status})`, 'auth');
      if (!res.ok) throw new TtsError(`Azure TTS HTTP ${res.status}`, res.status === 400 ? 'unsupported_language' : 'other');
      return { data: Buffer.from(await res.arrayBuffer()), mime: 'audio/mpeg' };
    } catch (e) {
      if (e instanceof TtsError || (e as Error).name === 'AbortError') throw e;
      throw new TtsError(`network error: ${(e as Error).message}`, 'network');
    }
  }

  async check(signal?: AbortSignal) {
    try {
      await this.synth('Haye', 'so', signal ?? AbortSignal.timeout(10_000));
      return { ok: true, detail: `voice ${this.voiceSo} synthesised a test phrase` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
