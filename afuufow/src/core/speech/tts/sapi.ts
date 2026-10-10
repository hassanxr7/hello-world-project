import { type AudioClip, type TtsProvider, TtsError } from './types';

export type RunPowerShell = (script: string, opts?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<string>;

/**
 * Offline Windows SAPI voice (System.Speech). Windows ships NO Somali voice, so this provider only supports English.
 * It is the fallback for English replies and for short spoken error notices when the cloud is unreachable.
 */
export class SapiTtsProvider implements TtsProvider {
  readonly id = 'sapi' as const;
  readonly isCloud = false;
  constructor(
    private run: RunPowerShell,
    private voiceHint: () => string,
  ) {}

  supports(lang: 'so' | 'en') {
    return lang === 'en';
  }

  async synth(text: string, lang: 'so' | 'en', signal?: AbortSignal): Promise<AudioClip> {
    if (lang !== 'en') throw new TtsError('Windows has no Somali voice installed', 'unsupported_language');
    const b64 = Buffer.from(text, 'utf8').toString('base64');
    const hint = this.voiceHint().replace(/[^A-Za-z0-9 ._-]/g, '');
    const script = `
Add-Type -AssemblyName System.Speech
$t = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'))
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$male = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Gender -eq 'Male' -and $_.VoiceInfo.Culture.Name -like 'en*' }
$pick = $male | Where-Object { $_.VoiceInfo.Name -like '*${hint}*' } | Select-Object -First 1
if (-not $pick) { $pick = $male | Select-Object -First 1 }
if ($pick) { $s.SelectVoice($pick.VoiceInfo.Name) }
$ms = New-Object System.IO.MemoryStream
$s.SetOutputToWaveStream($ms)
$s.Speak($t)
[Convert]::ToBase64String($ms.ToArray())
`;
    const out = (await this.run(script, { signal, timeoutMs: 20_000 })).trim();
    if (!out) throw new TtsError('SAPI produced no audio', 'unavailable');
    return { data: Buffer.from(out, 'base64'), mime: 'audio/wav' };
  }

  async check(signal?: AbortSignal) {
    try {
      await this.synth('Test', 'en', signal);
      return { ok: true, detail: 'Windows SAPI English male voice works (no Somali voice exists offline)' };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
