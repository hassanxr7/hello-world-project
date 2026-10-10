import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/core/config/settings';
import { type MlBackend, type PipelineEvents, VoicePipeline } from '../src/core/speech/pipeline';
import { SelfSpeechFilter } from '../src/core/speech/selfecho';
import { matchWakeWord } from '../src/core/speech/wake';

class FakeMl implements MlBackend {
  segments: Float32Array[] = [];
  kwsHit: string | null = null;
  transcript = '';
  kws = false;
  asr = true;
  frames = 0;
  async vadAccept() { this.frames++; const s = this.segments.splice(0); return s.map((samples) => ({ samples })); }
  async vadSpeaking() { return false; }
  async vadReset() { /* */ }
  async kwsAccept() { const k = this.kwsHit; this.kwsHit = null; return k; }
  async transcribeLocal() { return this.transcript; }
  hasLocalAsr() { return this.asr; }
  hasKws() { return this.kws; }
}
const rig = (mut?: (s: ReturnType<typeof defaultSettings>) => void) => {
  const settings = defaultSettings();
  settings.audio.wakeWordEnabled = true;
  mut?.(settings);
  const ml = new FakeMl();
  const log: string[] = [];
  const utter: Array<{ len: number; fromWake: boolean; duringSpeech: boolean }> = [];
  const clock = { t: 1000 };
  const ev: PipelineEvents = {
    onMode: (m) => log.push('mode:' + m),
    onWake: (r) => log.push('wake:' + (r ?? '')),
    onUtterance: (pcm, c) => utter.push({ len: pcm.length, ...c }),
    onNotice: (k) => log.push('notice:' + k),
    onLevel: () => undefined,
  };
  const echo = new SelfSpeechFilter(20000, () => clock.t);
  const p = new VoicePipeline(ml, () => settings, echo, ev, () => clock.t);
  return { p, ml, log, utter, settings, clock, echo };
};
const seg = (sec: number) => new Float32Array(Math.round(sec * 16000)).fill(0.1);
const frame = new Float32Array(512);

describe('wake word matching', () => {
  it.each([
    ['Afuufow', ''], ['Afuufow, Chrome fur', 'Chrome fur'], ['afufo chrome fur', 'chrome fur'], ['A fufow downloads-ka fur', 'downloads-ka fur'], ['hey Afufow jooji', 'jooji'],
  ])('%s', (t, rest) => {
    const m = matchWakeWord(t, 'Afuufow');
    expect(m.matched).toBe(true);
    expect(m.rest).toBe(rest);
  });
  it.each(['Chrome fur', 'Africa is big', 'Hassan wuu yimid', 'ii shid heesta Believer', ''])('does not trigger on "%s"', (t) => {
    expect(matchWakeWord(t, 'Afuufow').matched).toBe(false);
  });
  it('learned aliases extend matching', () => {
    expect(matchWakeWord('Abu Fou chrome fur', 'Afuufow', ['abufou']).matched).toBe(true);
  });
});

describe('voice pipeline', () => {
  it('does nothing while the microphone is disabled (pause stops processing immediately)', async () => {
    const r = rig();
    r.ml.segments.push(seg(1));
    await r.p.onFrame(frame);
    expect(r.ml.frames).toBe(0);
    expect(r.utter).toEqual([]);
    r.p.setMicEnabled(true);
    r.p.setMicEnabled(false);
    await r.p.onFrame(frame);
    expect(r.ml.frames).toBe(0);
  });
  it('with push-to-talk only (no wake word) nothing is processed until the key is pressed', async () => {
    const r = rig((s) => { s.audio.wakeWordEnabled = false; });
    r.p.setMicEnabled(true);
    await r.p.onFrame(frame);
    expect(r.p.currentMode).toBe('off');
    expect(r.ml.frames).toBe(0);
    expect(r.p.beginPushToTalk()).toBe(true);
    for (let i = 0; i < 30; i++) await r.p.onFrame(new Float32Array(512).fill(0.1));
    r.p.endPushToTalk();
    expect(r.utter).toHaveLength(1);
    expect(r.utter[0]!.fromWake).toBe(false);
    expect(r.utter[0]!.len).toBe(30 * 512);
  });
  it('push-to-talk too short is reported as no speech', async () => {
    const r = rig();
    r.p.setMicEnabled(true);
    r.p.beginPushToTalk();
    await r.p.onFrame(frame);
    r.p.endPushToTalk();
    expect(r.log).toContain('notice:no_speech');
  });
  it('keyword spotter: wake -> next segment is the command', async () => {
    const r = rig();
    r.ml.kws = true;
    r.p.setMicEnabled(true);
    r.ml.kwsHit = 'AFUUFOW';
    await r.p.onFrame(frame);
    expect(r.log).toContain('wake:');
    expect(r.p.currentMode).toBe('command');
    r.ml.segments.push(seg(2));
    await r.p.onFrame(frame);
    expect(r.utter).toHaveLength(1);
    expect(r.utter[0]!.fromWake).toBe(true);
    expect(r.p.currentMode).toBe('wake');
  });
  it('transcript wake: a short segment containing the wake word opens the command window', async () => {
    const r = rig();
    r.p.setMicEnabled(true);
    r.ml.transcript = 'Afuufow';
    r.ml.segments.push(seg(1));
    await r.p.onFrame(frame);
    expect(r.log).toContain('wake:');
    expect(r.p.currentMode).toBe('command');
    r.ml.segments.push(seg(2));
    await r.p.onFrame(frame);
    expect(r.utter).toHaveLength(1);
  });
  it('wake word and command in one breath goes to the main recogniser', async () => {
    const r = rig();
    r.p.setMicEnabled(true);
    r.ml.transcript = 'Afuufow Chrome fur';
    r.ml.segments.push(seg(2));
    await r.p.onFrame(frame);
    expect(r.utter).toHaveLength(1);
    expect(r.utter[0]!.fromWake).toBe(true);
  });
  it('ordinary conversation without the wake word is discarded, never forwarded', async () => {
    const r = rig();
    r.p.setMicEnabled(true);
    r.ml.transcript = 'waan ku wada hadlayaa telefoonka';
    r.ml.segments.push(seg(2));
    await r.p.onFrame(frame);
    expect(r.utter).toEqual([]);
    expect(r.log.some((l) => l.startsWith('wake'))).toBe(false);
  });
  it('long speech is ignored in wake mode (not a wake phrase)', async () => {
    const r = rig();
    r.p.setMicEnabled(true);
    r.ml.transcript = 'Afuufow';
    r.ml.segments.push(seg(9));
    await r.p.onFrame(frame);
    expect(r.log.some((l) => l.startsWith('wake'))).toBe(false);
  });
  it('while the assistant is speaking only short barge-in segments are forwarded, flagged as during speech', async () => {
    const r = rig();
    r.ml.kws = false;
    r.p.setMicEnabled(true);
    r.echo.noteSpeaking('Waan fadhiistay Boss', 5000);
    r.ml.segments.push(seg(1.5));
    await r.p.onFrame(frame);
    expect(r.utter).toHaveLength(1);
    expect(r.utter[0]!.duringSpeech).toBe(true);
    r.ml.segments.push(seg(8));
    await r.p.onFrame(frame);
    expect(r.utter).toHaveLength(1);
  });
  it('missing local model: honest notice instead of silent failure', async () => {
    const r = rig();
    r.ml.asr = false;
    r.p.setMicEnabled(true);
    r.ml.segments.push(seg(1));
    await r.p.onFrame(frame);
    expect(r.log).toContain('notice:ml_error');
  });
  it('command window times out back to wake mode', async () => {
    const r = rig();
    r.p.setMicEnabled(true);
    r.p.openCommandWindow();
    r.clock.t += 20_000;
    await r.p.onFrame(frame);
    expect(r.p.currentMode).toBe('wake');
    expect(r.log).toContain('notice:no_speech');
  });
});
