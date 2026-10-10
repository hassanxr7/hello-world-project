import { describe, expect, it } from 'vitest';
import { DEFAULT_OWNER, VISITOR_AUDIO_DISCLOSURE, VISITOR_SNAPSHOT_DISCLOSURE, visitorConsentPhrase, visitorIntroPhrase } from '../src/shared/phrases';
import { defaultSettings } from '../src/core/config/settings';
import { GreetingPolicy, PresenceTracker, type FaceObs, classifyFace } from '../src/core/vision/presence';
import { VisitorGate, type VisitorIO, runVisitorFlow } from '../src/core/visitors/flow';
import { VisitorLog } from '../src/core/visitors/log';
import { buildVisitorReport, describeEvent } from '../src/core/visitors/report';
import { extractSelfReportedName, isDecline } from '../src/core/visitors/selfreport';
import { testKeys, tmpDir } from './helpers';

function io(reply: { text: string; audio?: Buffer } | null, log: string[] = [], snap: Buffer | null = Buffer.from('jpeg')): VisitorIO {
  return {
    speak: async (t) => { log.push('speak:' + t); },
    listen: async () => { log.push('listen'); return reply; },
    snapshot: async () => { log.push('snapshot'); return snap; },
  };
}
const inp = (mut?: (s: ReturnType<typeof defaultSettings>) => void) => {
  const settings = defaultSettings();
  settings.visitors.enabled = true;
  mut?.(settings);
  return { owner: DEFAULT_OWNER, settings, recognitionConfidence: 0.21, recognitionState: 'unknown' as const };
};
const mk = async () => { const l = new VisitorLog(tmpDir(), testKeys()); await l.load(); return l; };

describe('required visitor wording', () => {
  it('uses the exact sentences from the specification', () => {
    expect(visitorIntroPhrase(DEFAULT_OWNER)).toBe(
      'Salaan. Waxaan ahay Afuufow, caawiyaha Boss Hassan XR. Wajigaaga ma aqoonsan. Waxaad isticmaalaysaa laptop-ka Boss-kayga. Fadlan magacaaga ii sheeg iyo sida aad oggolaanshaha ku heshay.',
    );
    expect(visitorConsentPhrase(DEFAULT_OWNER)).toBe('Magaca iyo jawaabta aad bixiso waxaa loo kaydin doonaa si Hassan loogu wargeliyo.');
  });
});

describe('visitor interaction flow', () => {
  it('speaks the intro and the consent notice BEFORE it starts listening', async () => {
    const log: string[] = [];
    await runVisitorFlow(io({ text: 'Magacaygu waa Cabdi' }, log), await mk(), inp(), new AbortController().signal);
    const listenAt = log.indexOf('listen');
    expect(log.slice(0, listenAt)).toEqual([`speak:${visitorIntroPhrase(DEFAULT_OWNER)}`, `speak:${visitorConsentPhrase(DEFAULT_OWNER)}`]);
  });
  it('stores the response as SELF-REPORTED information with the consent status', async () => {
    const log = await mk();
    const ev = await runVisitorFlow(io({ text: 'Magacaygu waa Cabdi, Boss ayaa ii oggolaaday inaan ka shaqeeyo' }), log, inp(), new AbortController().signal);
    expect(ev).toMatchObject({
      faceRecognized: false, recognitionState: 'unknown', recognitionConfidence: 0.21, selfReportedName: 'Cabdi',
      consent: 'responded_after_notice', transcript: 'Magacaygu waa Cabdi, Boss ayaa ii oggolaaday inaan ka shaqeeyo', snapshotId: null, audioId: null,
    });
    expect(ev.noticeSpokenAt).not.toBeNull();
    expect(log.list()).toHaveLength(1);
  });
  it('a declining visitor is recorded as declined, with NO words or media saved, and is not questioned again', async () => {
    const log = await mk();
    const calls: string[] = [];
    const ev = await runVisitorFlow(io({ text: 'Ma doonayo inaan sheego' }, calls), log, inp((s) => { s.visitors.snapshot = 'disclosed'; }), new AbortController().signal);
    expect(ev.consent).toBe('declined');
    expect(ev.transcript).toBeNull();
    expect(ev.selfReportedName).toBeNull();
    expect(ev.snapshotId).toBeNull();
    expect(calls).not.toContain('snapshot');
    expect(calls.filter((c) => c === 'listen')).toHaveLength(1); // asked once
  });
  it('silence is recorded as no_response', async () => {
    const ev = await runVisitorFlow(io(null), await mk(), inp(), new AbortController().signal);
    expect(ev).toMatchObject({ consent: 'no_response', transcript: null });
  });
  it('a snapshot is stored only if the option is on, and the notice then discloses it', async () => {
    const log = await mk();
    const calls: string[] = [];
    const ev = await runVisitorFlow(io({ text: 'Waxaan ahay Faadumo' }, calls), log, inp((s) => { s.visitors.snapshot = 'disclosed'; }), new AbortController().signal);
    expect(calls.some((c) => c.includes(VISITOR_SNAPSHOT_DISCLOSURE))).toBe(true);
    expect(ev.snapshotId).not.toBeNull();
    expect((await log.blobs.get(ev.snapshotId!))!.toString()).toBe('jpeg');
    expect(ev.disclosures).toEqual(['snapshot']);
    const off = await runVisitorFlow(io({ text: 'Waxaan ahay Faadumo' }), await mk(), inp(), new AbortController().signal);
    expect(off.snapshotId).toBeNull();
  });
  it('audio is saved only when enabled AND disclosed', async () => {
    const log = await mk();
    const calls: string[] = [];
    const ev = await runVisitorFlow(io({ text: 'Waxaan ahay Faadumo', audio: Buffer.from('pcm') }, calls), log, inp((s) => { s.visitors.saveAudio = true; }), new AbortController().signal);
    expect(calls.some((c) => c.includes(VISITOR_AUDIO_DISCLOSURE))).toBe(true);
    expect(ev.audioId).not.toBeNull();
    const off = await runVisitorFlow(io({ text: 'Waxaan ahay Faadumo', audio: Buffer.from('pcm') }), log, inp(), new AbortController().signal);
    expect(off.audioId).toBeNull();
  });
  it('if the owner returns mid-flow nothing the visitor said is kept', async () => {
    const log = await mk();
    const ctl = new AbortController();
    const slowIo: VisitorIO = {
      speak: async () => undefined,
      listen: async () => { ctl.abort(); throw Object.assign(new Error('aborted'), { name: 'AbortError' }); },
      snapshot: async () => Buffer.from('x'),
    };
    const ev = await runVisitorFlow(slowIo, log, inp(), ctl.signal);
    expect(ev.consent).toBe('interrupted');
    expect(ev.transcript).toBeNull();
  });
  it('records camera observations only; nothing about gender or intent is inferred', async () => {
    const ev = await runVisitorFlow(io({ text: 'Waxaan ahay Cumar' }), await mk(), inp(), new AbortController().signal);
    expect(ev.selfReportedGender).toBeNull();
    expect(Object.keys(ev)).not.toContain('gender');
  });
  it('gate prevents asking the same person again inside the cooldown', () => {
    const c = { t: 0 };
    const g = new VisitorGate(() => c.t);
    expect(g.canStart(30)).toBe(true);
    g.started(30);
    c.t = 10 * 60_000;
    expect(g.canStart(30)).toBe(false);
    c.t = 31 * 60_000;
    expect(g.canStart(30)).toBe(true);
  });
});

describe('self-reported name extraction', () => {
  it.each([
    ['Magacaygu waa Cabdi', 'Cabdi'], ['Waxaan ahay Faadumo Cali', 'Faadumo Cali'], ['My name is John', 'John'], ["I'm Sara and I work with Hassan", 'Sara'], ['hello', null],
  ])('%s', (t, n) => expect(extractSelfReportedName(t)).toBe(n));
  it('detects refusals', () => {
    expect(isDecline('Ma doonayo')).toBe(true);
    expect(isDecline('no')).toBe(true);
    expect(isDecline("I don't want to say")).toBe(true);
    expect(isDecline('Magacaygu waa Cabdi')).toBe(false);
  });
});

describe('visitor log', () => {
  it('persists, reports once, supports notes, known-labelling and deletion with media', async () => {
    const dir = tmpDir();
    const keys = testKeys();
    const l1 = new VisitorLog(dir, keys);
    await l1.load();
    const ev = await runVisitorFlow(io({ text: 'Waxaan ahay Faadumo' }), l1, inp((s) => { s.visitors.snapshot = 'disclosed'; }), new AbortController().signal);
    l1.addNote(ev.id, 'Waa saaxiibkay');
    await l1.flush();
    const l2 = new VisitorLog(dir, keys);
    await l2.load();
    expect(l2.list()).toHaveLength(1);
    expect(l2.pending()).toHaveLength(1);
    expect(l2.get(ev.id)!.ownerNote).toBe('Waa saaxiibkay');
    l2.markReported([ev.id]);
    expect(l2.pending()).toHaveLength(0);
    l2.markKnown(ev.id, 'Faadumo');
    expect(l2.get(ev.id)!.markedKnownAs).toBe('Faadumo');
    const blob = await l2.blobs.get(ev.snapshotId!);
    expect(blob).not.toBeNull();
    l2.delete(ev.id);
    expect(l2.list()).toHaveLength(0);
    expect(await l2.blobs.get(ev.snapshotId!)).toBeNull();
  });
  it('keeps Windows session events SEPARATE from camera observations', async () => {
    const l = await mk();
    const ev = await runVisitorFlow(io({ text: 'Waxaan ahay Cumar' }), l, inp(), new AbortController().signal);
    l.addSession({ at: ev.at - 60_000, kind: 'unlock', source: 'power-monitor' });
    expect(l.list()[0]).not.toHaveProperty('unlockedAt');
    expect(l.sessionEvents()).toHaveLength(1);
    expect(l.sessionNear(ev.at, 5 * 60_000)).toHaveLength(1);
  });
  it('retention removes old events and their media', async () => {
    const l = await mk();
    const ev = await runVisitorFlow(io({ text: 'Waxaan ahay Cumar' }), l, inp((s) => { s.visitors.snapshot = 'disclosed'; }), new AbortController().signal);
    expect(l.prune(ev.at + 2 * 86_400_000, 1, 1)).toBe(1);
    expect(l.list()).toEqual([]);
    expect(await l.blobs.get(ev.snapshotId!)).toBeNull();
  });
});

describe('reporting to the verified owner', () => {
  const baseInput = async (consentText: string | null = 'Magacaygu waa Cabdi, Boss ayaa ii oggolaaday') => {
    const l = await mk();
    await runVisitorFlow(io(consentText ? { text: consentText } : null), l, inp(), new AbortController().signal);
    return l;
  };
  it('tells nothing until the owner is verified', async () => {
    const l = await baseInput();
    const r = buildVisitorReport({ owner: DEFAULT_OWNER, pending: l.pending(), sessionNear: () => [], now: Date.now(), verified: false, othersPresent: false, ownerRequestedAloud: false })!;
    expect(r.spoken).toBe('');
    expect(r.screenOnly).toBe(true);
  });
  it('does not read details aloud when someone else is present, unless asked', async () => {
    const l = await baseInput();
    const quiet = buildVisitorReport({ owner: DEFAULT_OWNER, pending: l.pending(), sessionNear: () => [], now: Date.now(), verified: true, othersPresent: true, ownerRequestedAloud: false })!;
    expect(quiet.spoken).not.toContain('Cabdi');
    expect(quiet.screenOnly).toBe(true);
    const asked = buildVisitorReport({ owner: DEFAULT_OWNER, pending: l.pending(), sessionNear: () => [], now: Date.now(), verified: true, othersPresent: true, ownerRequestedAloud: true })!;
    expect(asked.spoken).toContain('Cabdi');
  });
  it('speaks name, time and the visitor\'s own words, and asks the follow-up question', async () => {
    const l = await baseInput();
    const r = buildVisitorReport({ owner: DEFAULT_OWNER, pending: l.pending(), sessionNear: () => [], now: Date.now(), verified: true, othersPresent: false, ownerRequestedAloud: false })!;
    expect(r.spoken).toContain('Boss Hassan XR');
    expect(r.spoken).toContain('qof aanan aqoonsan ayaa kamaradda ka muuqday maanta saacadda');
    expect(r.spoken).toContain('Cabdi');
    expect(r.spoken).toContain('‘Magacaygu waa Cabdi, Boss ayaa ii oggolaaday’');
    expect(r.spoken.endsWith('Ma la socotaa? Ma rabtaa inaan ku tuso diiwaanka?')).toBe(true);
  });
  it('uses neutral wording unless the person SELF-reported a gender', async () => {
    const l = await baseInput();
    const ev = l.pending()[0]!;
    expect(describeEvent(ev, Date.now())).not.toMatch(/Wuxuu|Waxay magaceeda/);
    expect(describeEvent({ ...ev, selfReportedGender: 'male' }, Date.now())).toContain('Wuxuu magaciisa ku sheegay Cabdi, wuxuuna yiri');
    expect(describeEvent({ ...ev, selfReportedGender: 'female' }, Date.now())).toContain('Waxay magaceeda ku sheegtay');
  });
  it('mentions a Windows unlock separately and never claims the visitor caused it', async () => {
    const l = await baseInput();
    const ev = l.pending()[0]!;
    l.addSession({ at: ev.at - 30_000, kind: 'unlock', source: 'power-monitor' });
    const r = buildVisitorReport({ owner: DEFAULT_OWNER, pending: l.pending(), sessionNear: (at) => l.sessionNear(at, 600_000), now: Date.now(), verified: true, othersPresent: false, ownerRequestedAloud: false })!;
    expect(r.spoken).toContain('Windows wuxuu diiwaangeliyay furitaan (unlock)');
    expect(r.spoken).toContain('ma xaqiijin karo in qofka kamaradda ka muuqday uu sababay');
  });
  it('declined and silent visitors are described without invented content', async () => {
    const l = await baseInput('Ma doonayo inaan sheego');
    expect(describeEvent(l.pending()[0]!, Date.now())).toContain('jawaab bixin ma doonin');
    const s = await baseInput(null);
    expect(describeEvent(s.pending()[0]!, Date.now())).toContain('Jawaab lama helin');
  });
  it('returns nothing when there are no pending events', async () => {
    expect(buildVisitorReport({ owner: DEFAULT_OWNER, pending: [], sessionNear: () => [], now: 0, verified: true, othersPresent: false, ownerRequestedAloud: false })).toBeNull();
  });
});

describe('face presence tracking', () => {
  const cfg = () => ({ ...defaultSettings().camera, stableFrames: 3, leaveAfterSec: 30 });
  const owner: FaceObs = { ownerSimilarity: 0.9, knownSimilarity: null, liveness: 0.9, qualityOk: true };
  const stranger: FaceObs = { ownerSimilarity: 0.2, knownSimilarity: null, liveness: 0.9, qualityOk: true };
  const maybe: FaceObs = { ownerSimilarity: 0.55, knownSimilarity: null, liveness: 0.9, qualityOk: true };
  const photo: FaceObs = { ownerSimilarity: 0.9, knownSimilarity: null, liveness: 0.1, qualityOk: true };
  const frame = (ts: number, faces: FaceObs[], luminance = 0.5) => ({ ts, faces, luminance });

  it('classifies by thresholds with an honest "uncertain" band', () => {
    const c = cfg();
    expect(classifyFace(owner, c)).toBe('owner');
    expect(classifyFace(stranger, c)).toBe('unknown');
    expect(classifyFace(maybe, c)).toBe('uncertain');
    expect(classifyFace(photo, c)).toBe('possible_photo');
    expect(classifyFace({ ...owner, qualityOk: false, qualityReason: 'dark' }, c)).toBe('uncertain');
    expect(classifyFace({ ...stranger, ownerSimilarity: null }, c)).toBe('uncertain'); // not enrolled: cannot call anyone a stranger
  });
  it('requires several consecutive frames before declaring the owner arrived', () => {
    const t = new PresenceTracker(cfg());
    expect(t.push(frame(1, [owner]))).toEqual([]);
    expect(t.push(frame(2, [owner]))).toEqual([]);
    expect(t.push(frame(3, [owner])).map((e) => e.type)).toEqual(['owner_arrived']);
    expect(t.push(frame(4, [owner])).map((e) => e.type)).toEqual(['owner_seen']);
    expect(t.snapshot.ownerPresent).toBe(true);
  });
  it('a single noisy frame does not trigger anything', () => {
    const t = new PresenceTracker(cfg());
    t.push(frame(1, [owner]));
    t.push(frame(2, [stranger]));
    expect(t.push(frame(3, [owner]))).toEqual([]);
  });
  it('detects leaving and returning', () => {
    const t = new PresenceTracker(cfg());
    for (let i = 1; i <= 3; i++) t.push(frame(i * 1000, [owner]));
    expect(t.push(frame(20_000, [])).map((e) => e.type)).toEqual([]);
    expect(t.push(frame(40_000, [])).map((e) => e.type)).toEqual(['owner_left']);
    t.push(frame(41_000, [owner]));
    t.push(frame(42_000, [owner]));
    expect(t.push(frame(43_000, [owner])).find((e) => e.type === 'owner_arrived')).toMatchObject({ returning: true });
  });
  it('an unknown person triggers the visitor event only when stable, and leaving is detected', () => {
    const t = new PresenceTracker(cfg());
    t.push(frame(1000, [stranger]));
    t.push(frame(2000, [stranger]));
    expect(t.push(frame(3000, [stranger])).map((e) => e.type)).toEqual(['unknown_arrived']);
    expect(t.snapshot.visitorPresent).toBe(true);
    expect(t.push(frame(20_000, [])).map((e) => e.type)).toEqual(['unknown_left']);
    expect(t.snapshot.visitorPresent).toBe(false);
  });
  it('a stranger next to the owner is "others present", not a visitor event', () => {
    const t = new PresenceTracker(cfg());
    for (let i = 1; i <= 3; i++) t.push(frame(i * 1000, [owner, stranger]));
    expect(t.snapshot.othersWithOwner).toBe(true);
    expect(t.snapshot.visitorPresent).toBe(false);
  });
  it('a photo of the owner is never accepted and is reported', () => {
    const t = new PresenceTracker(cfg());
    const evs = [1, 2, 3, 4].flatMap((i) => t.push(frame(i * 1000, [photo])));
    expect(evs.some((e) => e.type === 'owner_arrived')).toBe(false);
    expect(evs.some((e) => e.type === 'possible_photo')).toBe(true);
  });
  it('uncertain similarity yields an honest "uncertain" notice, not a greeting or a visitor flow', () => {
    const t = new PresenceTracker(cfg());
    const evs = [1, 2, 3, 4].flatMap((i) => t.push(frame(i * 1000, [maybe])));
    expect(evs.map((e) => e.type)).toEqual(['uncertain']);
    expect(t.snapshot.uncertain).toBe(true);
  });
  it('gives lighting feedback', () => {
    const t = new PresenceTracker(cfg());
    expect(t.push(frame(1, [], 0.05)).map((e) => e.type)).toEqual(['lighting']);
  });
  it('greeting cooldown', () => {
    const c = { t: 100_000 };
    const g = new GreetingPolicy(() => ({ faceCooldownMs: 60_000, activationCooldownMs: 10_000 }), () => c.t);
    expect(g.shouldGreetOnFace()).toBe(true);
    g.markGreeted();
    expect(g.shouldGreetOnFace()).toBe(false);
    c.t += 61_000;
    expect(g.shouldGreetOnFace()).toBe(true);
  });
});
