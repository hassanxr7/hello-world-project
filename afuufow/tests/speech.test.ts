import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/core/config/settings';
import { pcmToWav, rms, wavHeader } from '../src/core/speech/audio';
import { AzureSttProvider } from '../src/core/speech/stt/azure';
import { OpenAISttProvider } from '../src/core/speech/stt/openai';
import { SttRouter, sttErrorMessage } from '../src/core/speech/stt/router';
import { type SttProvider, SttError } from '../src/core/speech/stt/types';
import { AzureTtsProvider, buildSsml } from '../src/core/speech/tts/azure';
import { SpeechEngine } from '../src/core/speech/tts/engine';
import { type AudioClip, type AudioPlayer, type TtsProvider, TtsError } from '../src/core/speech/tts/types';

describe('audio helpers', () => {
  it('writes a valid WAV header', () => {
    const w = pcmToWav(new Int16Array(160));
    expect(w.subarray(0, 4).toString()).toBe('RIFF');
    expect(w.readUInt32LE(24)).toBe(16000);
    expect(w.readUInt32LE(40)).toBe(320);
    expect(w.length).toBe(364);
    expect(wavHeader(0xffffffff).readUInt32LE(40)).toBe(0xffffffff);
  });
  it('computes RMS', () => expect(rms(new Int16Array([0, 0]))).toBe(0));
});

describe('Azure TTS', () => {
  it('builds SSML for the Somali male voice and escapes text', () => {
    const x = buildSsml('Salaan <Boss> & "Hassan"', 'so-SO-MuuseNeural', 'so-SO', 1);
    expect(x).toContain('name="so-SO-MuuseNeural"');
    expect(x).toContain('xml:lang="so-SO"');
    expect(x).toContain('Salaan &lt;Boss&gt; &amp; &quot;Hassan&quot;');
    expect(buildSsml('x', 'v', 'so-SO', 1.2)).toContain('<prosody rate="+20%">');
  });
  it('sends the key in a header (never in the URL) and the right output format', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(new Uint8Array([1, 2, 3]), { status: 200 }); }) as unknown as typeof fetch;
    const p = new AzureTtsProvider('westeurope', 'so-SO-MuuseNeural', () => 'KEY123', () => 1, 'en-US-GuyNeural', f);
    const clip = await p.synth('Haye', 'so');
    expect(clip.mime).toBe('audio/mpeg');
    expect(seen!.url).toBe('https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1');
    expect(seen!.url).not.toContain('KEY123');
    expect((seen!.init.headers as Record<string, string>)['Ocp-Apim-Subscription-Key']).toBe('KEY123');
    expect(String(seen!.init.body)).toContain('so-SO-MuuseNeural');
    await p.synth('Hello', 'en');
    expect(String(seen!.init.body)).toContain('en-US-GuyNeural');
  });
  it('maps auth failures and missing keys to clear errors', async () => {
    const bad = new AzureTtsProvider('x', 'v', () => 'k', () => 1, 'e', (async () => new Response('', { status: 401 })) as unknown as typeof fetch);
    await expect(bad.synth('a', 'so')).rejects.toMatchObject({ kind: 'auth' });
    const none = new AzureTtsProvider('x', 'v', () => null, () => 1);
    await expect(none.synth('a', 'so')).rejects.toMatchObject({ kind: 'auth' });
    const offline = new AzureTtsProvider('x', 'v', () => 'k', () => 1, 'e', (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch);
    await expect(offline.synth('a', 'so')).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('Azure STT', () => {
  it('posts WAV audio with the key header and parses the detailed result', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ RecognitionStatus: 'Success', DisplayText: 'Chrome fur.', NBest: [{ Confidence: 0.91, Display: 'Chrome fur.' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new AzureSttProvider('eastus', () => 'KEY', 'so-SO', f);
    const r = await p.transcribe(new Int16Array(16000));
    expect(r).toMatchObject({ text: 'Chrome fur.', confidence: 0.91, provider: 'azure', language: 'so-SO' });
    expect(seen!.url).toContain('language=so-SO');
    expect(seen!.url).not.toContain('KEY');
    expect((seen!.init.headers as Record<string, string>)['Content-Type']).toContain('samplerate=16000');
  });
  it('reports NoMatch as an empty result, not an error', async () => {
    const f = (async () => new Response(JSON.stringify({ RecognitionStatus: 'NoMatch' }), { status: 200 })) as unknown as typeof fetch;
    const r = await new AzureSttProvider('eastus', () => 'k', 'so-SO', f).transcribe(new Int16Array(100));
    expect(r.noMatch).toBe(true);
    expect(r.text).toBe('');
  });
  it('classifies errors', async () => {
    const mk = (status: number) => new AzureSttProvider('eastus', () => 'k', 'so-SO', (async () => new Response('', { status })) as unknown as typeof fetch);
    await expect(mk(401).transcribe(new Int16Array(10))).rejects.toMatchObject({ kind: 'auth' });
    await expect(mk(429).transcribe(new Int16Array(10))).rejects.toMatchObject({ kind: 'quota' });
    const off = new AzureSttProvider('eastus', () => 'k', 'so-SO', (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch);
    await expect(off.transcribe(new Int16Array(10))).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('OpenAI-compatible STT', () => {
  it('uploads multipart audio with language and bias prompt', async () => {
    let body: FormData | null = null;
    const f = (async (_u: string, init: RequestInit) => { body = init.body as FormData; return new Response(JSON.stringify({ text: ' Downloads-ka fur ' }), { status: 200 }); }) as unknown as typeof fetch;
    const p = new OpenAISttProvider('http://127.0.0.1:8080/v1', 'whisper-1', () => null, f);
    expect(p.isCloud).toBe(false);
    const r = await p.transcribe(new Int16Array(1600), { language: 'so-SO', prompt: 'Afuufow' });
    expect(r.text).toBe('Downloads-ka fur');
    expect(body!.get('language')).toBe('so');
    expect(body!.get('prompt')).toBe('Afuufow');
    expect(new OpenAISttProvider('https://api.openai.com/v1', 'm', () => 'k', f).isCloud).toBe(true);
  });
});

describe('local (on-device) recognition policy', () => {
  const backend = { ready: () => true, modelName: () => 'whisper-small', transcribe: async () => ({ text: 'hello', ms: 5 }) };
  it('refuses Somali (measured WER ~100%, Arabic-script output) and serves English', async () => {
    const { LocalSttProvider } = await import('../src/core/speech/stt/local');
    const p = new LocalSttProvider(backend);
    await expect(p.transcribe(new Int16Array(100), { language: 'so' })).rejects.toMatchObject({ kind: 'unavailable' });
    expect((await p.transcribe(new Int16Array(100), { language: 'en' })).text).toBe('hello');
  });
});

describe('STT routing and privacy', () => {
  const fake = (id: 'azure' | 'local', isCloud: boolean, impl: () => Promise<string>): SttProvider => ({
    id, isCloud,
    transcribe: async () => ({ text: await impl(), confidence: null, provider: id, language: 'so', latencyMs: 1 }),
    check: async () => ({ ok: true, detail: '' }),
  });
  it('refuses cloud recognition until the owner enables it, and uses the local fallback', async () => {
    const s = defaultSettings();
    const router = new SttRouter(() => s, () => ({ azure: fake('azure', true, async () => 'cloud'), local: fake('local', false, async () => 'local') }));
    expect((await router.transcribe(new Int16Array(10))).text).toBe('local');
    s.privacy.allowCloudStt = true;
    expect((await router.transcribe(new Int16Array(10))).text).toBe('cloud');
  });
  it('falls back when the primary fails (e.g. offline) and keeps the cause when everything fails', async () => {
    const s = defaultSettings();
    s.privacy.allowCloudStt = true;
    const failing = fake('azure', true, async () => { throw new SttError('network error', 'network'); });
    const router = new SttRouter(() => s, () => ({ azure: failing, local: fake('local', false, async () => 'offline text') }));
    expect((await router.transcribe(new Int16Array(10))).text).toBe('offline text');
    const none = new SttRouter(() => s, () => ({ azure: failing }));
    await expect(none.transcribe(new Int16Array(10))).rejects.toMatchObject({ kind: 'network' });
  });
  it('error messages are in Somali and actionable', () => {
    expect(sttErrorMessage(new SttError('x', 'network')).so).toContain('Internetka');
    expect(sttErrorMessage(new SttError('x', 'auth')).so).toContain('Furaha');
  });
});

class FakePlayer implements AudioPlayer {
  played: string[] = [];
  active = 0;
  maxActive = 0;
  stopped = 0;
  playMs = 5;
  private cancel: (() => void) | null = null;
  async play(clip: AudioClip) {
    this.played.push(clip.data.toString());
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise<void>((r) => { const t = setTimeout(r, this.playMs); this.cancel = () => { clearTimeout(t); r(); }; });
    this.active--;
  }
  stop() { this.stopped++; this.cancel?.(); }
}
const fakeTts = (id: 'azure' | 'sapi', o: { cloud?: boolean; langs?: Array<'so' | 'en'>; delay?: number; fail?: boolean } = {}) => {
  const calls: string[] = [];
  const p: TtsProvider & { calls: string[] } = {
    id, isCloud: o.cloud ?? false, calls,
    supports: (l) => (o.langs ?? ['so', 'en']).includes(l),
    synth: async (t) => { calls.push(t); if (o.delay) await new Promise((r) => setTimeout(r, o.delay)); if (o.fail) throw new TtsError('boom', 'network'); return { data: Buffer.from(t), mime: 'audio/mpeg' }; },
    check: async () => ({ ok: true, detail: '' }),
  };
  return p;
};

describe('speech engine', () => {
  const cloudOn = () => { const s = defaultSettings(); s.privacy.allowCloudTts = true; return s; };
  it('plays sentences strictly in order', async () => {
    const s = cloudOn();
    const azure = fakeTts('azure', { cloud: true, delay: 10 });
    const pl = new FakePlayer();
    const e = new SpeechEngine(() => s, () => ({ azure }), pl);
    await Promise.all([e.speak('Kow'), e.speak('Labo'), e.speak('Saddex')]);
    expect(pl.played).toEqual(['Kow', 'Labo', 'Saddex']);
    expect(pl.maxActive).toBe(1);
  });
  it('synthesises the next sentence while the current one is playing (prefetch)', async () => {
    const s = cloudOn();
    const azure = fakeTts('azure', { cloud: true });
    const pl = new FakePlayer();
    pl.playMs = 60;
    const e = new SpeechEngine(() => s, () => ({ azure }), pl);
    const a = e.speak('Kow');
    const b = e.speak('Labo');
    await new Promise((r) => setTimeout(r, 20));
    expect(azure.calls).toEqual(['Kow', 'Labo']); // second already synthesised during first playback
    await Promise.all([a, b]);
  });
  it('stop() flushes the queue and interrupts playback immediately', async () => {
    const s = cloudOn();
    const pl = new FakePlayer();
    pl.playMs = 500;
    const e = new SpeechEngine(() => s, () => ({ azure: fakeTts('azure', { cloud: true }) }), pl);
    const all = Promise.all([e.speak('Kow'), e.speak('Labo'), e.speak('Saddex')]);
    await new Promise((r) => setTimeout(r, 30));
    e.stop();
    await all;
    expect(pl.played).toEqual(['Kow']);
    expect(pl.stopped).toBeGreaterThan(0);
    await e.speak('Mar kale'); // usable again after a stop
    expect(pl.played.at(-1)).toBe('Mar kale');
  });
  it('an abort signal cancels just that utterance', async () => {
    const s = cloudOn();
    const pl = new FakePlayer();
    pl.playMs = 200;
    const e = new SpeechEngine(() => s, () => ({ azure: fakeTts('azure', { cloud: true }) }), pl);
    const ctl = new AbortController();
    const p = e.speak('Kow', ctl.signal);
    await new Promise((r) => setTimeout(r, 20));
    ctl.abort();
    await p;
    expect(pl.stopped).toBeGreaterThan(0);
  });
  it('refuses cloud synthesis when disabled and says why', async () => {
    const s = defaultSettings();
    s.providers.tts.fallback = 'none';
    const e = new SpeechEngine(() => s, () => ({ azure: fakeTts('azure', { cloud: true }) }), new FakePlayer());
    await expect(e.speak('Haye')).rejects.toMatchObject({ kind: 'cloud_disabled' });
  });
  it('Somali has no offline voice: SAPI is skipped for Somali but used for English', async () => {
    const s = defaultSettings();
    const sapi = fakeTts('sapi', { langs: ['en'] });
    const pl = new FakePlayer();
    const e = new SpeechEngine(() => s, () => ({ azure: fakeTts('azure', { cloud: true }), sapi }), pl);
    await expect(e.speak('Salaan', undefined, 'so')).rejects.toBeTruthy();
    await e.speak('Hello', undefined, 'en');
    expect(pl.played).toEqual(['Hello']);
  });
  it('falls back to the next provider when the primary errors', async () => {
    const s = cloudOn();
    const pl = new FakePlayer();
    const e = new SpeechEngine(() => s, () => ({ azure: fakeTts('azure', { cloud: true, fail: true }), sapi: fakeTts('sapi', { langs: ['en'] }) }), pl);
    await e.speak('Hello', undefined, 'en');
    expect(pl.played).toEqual(['Hello']);
  });
  it('caches repeated phrases (greeting works without another request)', async () => {
    const s = cloudOn();
    const azure = fakeTts('azure', { cloud: true });
    const metrics: boolean[] = [];
    const e = new SpeechEngine(() => s, () => ({ azure }), new FakePlayer(), (m) => metrics.push(m.cached));
    await e.speak('Mudane Hassan Mohamed, Boss Hassan XR, waan taaganahay.');
    await e.speak('Mudane Hassan Mohamed, Boss Hassan XR, waan taaganahay.');
    expect(azure.calls).toHaveLength(1);
    expect(metrics).toEqual([false, true]);
  });
});
