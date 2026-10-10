import { describe, expect, it } from 'vitest';
import { type CompanionFacts, companionDecision } from '../src/core/assistant/companion';
import { defaultSettings } from '../src/core/config/settings';
import { makeRig } from './helpers';

const MIN = 60_000;
const facts = (o: Partial<CompanionFacts> = {}): CompanionFacts => ({
  now: 10_000 * MIN,
  settings: defaultSettings().companion,
  micOn: true, speakerOn: true, paused: false, busy: false,
  visitorPresent: false, othersPresent: false,
  cameraOn: true, ownerSeenByCamera: true,
  lastOwnerAt: 10_000 * MIN - 10 * MIN, lastProactiveAt: 0, proactiveTimes: [], unanswered: 0, snoozeUntil: 0, speechFailedAt: 0,
  ...o,
});

describe('companion decision (when Afuufow may speak first)', () => {
  it('speaks when the owner is seen, it has been quiet and nothing else is going on', () => {
    expect(companionDecision(facts()).speak).toBe(true);
  });
  it.each([
    ['disabled', { settings: { ...defaultSettings().companion, proactive: false } }],
    ['microphone off (it could not hear the answer)', { micOn: false }],
    ['speaker off', { speakerOn: false }],
    ['paused', { paused: true }],
    ['busy', { busy: true }],
    ['a visitor is present', { visitorPresent: true }],
    ['others are with the owner', { othersPresent: true }],
    ['camera is on and the owner is not seen', { ownerSeenByCamera: false }],
    ['not quiet long enough', { lastOwnerAt: 10_000 * MIN - 1 * MIN }],
    ['snoozed', { snoozeUntil: 10_000 * MIN + 5 * MIN }],
    ['speech output failed recently', { speechFailedAt: 10_000 * MIN - 5 * MIN }],
    ['three remarks went unanswered', { unanswered: 3 }],
    ['hourly limit reached', { proactiveTimes: [1, 2, 3, 4, 5].map((i) => 10_000 * MIN - i * 5 * MIN) }],
  ] as const)('stays quiet: %s', (_n, o) => {
    expect(companionDecision(facts(o as Partial<CompanionFacts>)).speak).toBe(false);
  });
  it('waits longer after each unanswered remark', () => {
    const base = { lastOwnerAt: 10_000 * MIN - 6 * MIN };
    expect(companionDecision(facts({ ...base, unanswered: 0 })).speak).toBe(true);
    expect(companionDecision(facts({ ...base, unanswered: 1 })).speak).toBe(false); // needs 8 min
  });
  it('without a camera it needs a recent interaction as evidence the owner is around', () => {
    expect(companionDecision(facts({ cameraOn: false, lastOwnerAt: 0 })).speak).toBe(false);
    expect(companionDecision(facts({ cameraOn: false, lastOwnerAt: 10_000 * MIN - 10 * MIN })).speak).toBe(true);
    expect(companionDecision(facts({ cameraOn: false, lastOwnerAt: 10_000 * MIN - 40 * MIN })).speak).toBe(false);
  });
});

describe('assistant companion behaviour', () => {
  const setup = () => makeRig({ settings: (s) => { s.audio.micEnabled = true; } });

  it('keeps listening for the answer after a voice reply (no wake word needed)', async () => {
    const r = await setup();
    await r.a.handle('Fariiso.', { source: 'voice' });
    expect(r.events.some((e) => e.type === 'listen')).toBe(true);
  });
  it('does not open a reply window after a typed command, or when follow-up is off', async () => {
    const r = await setup();
    await r.a.handle('Fariiso.', { source: 'text' });
    expect(r.events.some((e) => e.type === 'listen')).toBe(false);
    r.settings.companion.followUp = false;
    await r.a.handle('Fariiso.', { source: 'voice' });
    expect(r.events.some((e) => e.type === 'listen')).toBe(false);
  });
  it('speaks first after a quiet period, shows it in the transcript and opens a reply window', async () => {
    const r = await setup();
    await r.a.handle('Fariiso.', { source: 'voice' });
    r.speech.spoken.length = 0;
    r.events.length = 0;
    r.provider.responses = ['Mudane Hassan, maalintu sidee tahay?'];
    expect(await r.a.maybeStartConversation()).toBe(false); // too soon
    r.clock.t += 5 * MIN;
    expect(await r.a.maybeStartConversation()).toBe(true);
    expect(r.speech.spoken.join(' ')).toContain('maalintu sidee tahay');
    expect(r.events.some((e) => e.type === 'turn' && e.turn.role === 'assistant')).toBe(true);
    expect(r.events.some((e) => e.type === 'listen')).toBe(true);
    // the model was told it is its own cue, with no private owner facts
    const sys = r.provider.calls.at(-1)![0]!.content;
    expect(sys).not.toContain('Facts verified');
  });
  it('backs off when the owner does not answer, and resumes after they speak', async () => {
    const r = await setup();
    r.settings.camera.enabled = true; // the camera keeps confirming the owner is there
    r.presence.snapshot.ownerPresent = true;
    await r.a.handle('Fariiso.', { source: 'voice' });
    for (let i = 0; i < 3; i++) {
      r.clock.t += 30 * MIN;
      expect(await r.a.maybeStartConversation()).toBe(true);
    }
    r.clock.t += 120 * MIN;
    expect(await r.a.maybeStartConversation()).toBe(false); // 3 unanswered
    await r.a.handle('Fariiso.', { source: 'voice' });
    r.clock.t += 6 * MIN;
    expect(await r.a.maybeStartConversation()).toBe(true);
  });
  it('"jooji" right after it speaks up keeps it quiet for a long while', async () => {
    const r = await setup();
    await r.a.handle('Fariiso.', { source: 'voice' });
    r.clock.t += 5 * MIN;
    await r.a.maybeStartConversation();
    r.clock.t += 20_000;
    await r.a.handle('Jooji', { source: 'voice' });
    r.clock.t += 30 * MIN;
    r.speech.spoken.length = 0;
    expect(await r.a.maybeStartConversation()).toBe(false);
  });
  it('never speaks first while a stranger is in front of the camera', async () => {
    const r = await setup();
    await r.a.handle('Fariiso.', { source: 'voice' });
    r.clock.t += 10 * MIN;
    r.presence.snapshot.visitorPresent = true;
    expect(await r.a.maybeStartConversation()).toBe(false);
  });
  it('stays silent (no error spam) when the model is unreachable', async () => {
    const r = await setup();
    await r.a.handle('Fariiso.', { source: 'voice' });
    r.clock.t += 10 * MIN;
    r.provider.stream = async function* () { throw new Error('fetch failed'); } as never;
    r.events.length = 0;
    await r.a.maybeStartConversation();
    expect(r.events.some((e) => e.type === 'notice')).toBe(false);
  });
});
