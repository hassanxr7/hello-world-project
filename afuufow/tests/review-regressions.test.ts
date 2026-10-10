import { describe, expect, it } from 'vitest';
import { DEFAULT_OWNER } from '../src/shared/phrases';
import { defaultSettings } from '../src/core/config/settings';
import { parseCommand } from '../src/core/nlu/parser';
import { type VisitorIO, runVisitorFlow } from '../src/core/visitors/flow';
import { VisitorLog } from '../src/core/visitors/log';
import { extractSelfReportedName } from '../src/core/visitors/selfreport';
import { makeRig, testKeys, tmpDir } from './helpers';

const said = (r: { speech: { spoken: string[] } }) => r.speech.spoken;
const ask = async (r: Awaited<ReturnType<typeof makeRig>>) => {
  await r.a.handle('Hooyo u qor waan imaanayaa', { source: 'text' });
  expect(said(r).at(-1)).toBe('Ma dirayaa fariintan?');
};

describe('review fix 1: a confirmation is "yes" only when the whole answer is an affirmative', () => {
  for (const ans of ['ha dirina', 'ha diri', 'ha u dirina', 'ok but do not', 'haa maya', 'yes no wait', 'ma dirayo', "don't send it", 'ha tirtirin']) {
    it(`"${ans}" does not send`, async () => {
      const r = await makeRig();
      await ask(r);
      await r.a.handle(ans, { source: 'text' });
      expect(r.wa.sent).toEqual([]);
    });
  }
  for (const ans of ['haa', 'yes', 'ok', 'dir', 'haa dir', 'hubaal']) {
    it(`"${ans}" sends`, async () => {
      const r = await makeRig();
      await ask(r);
      await r.a.handle(ans, { source: 'text' });
      expect(r.wa.sent).toHaveLength(1);
    });
  }
});

describe('review fix 2: an unanswered confirmation does not stay armed', () => {
  it('"Chrome fur" then a late "ok" does not send the message', async () => {
    const r = await makeRig();
    await ask(r);
    await r.a.handle('Chrome fur', { source: 'text' });
    await r.a.handle('ok', { source: 'text' });
    expect(r.wa.sent).toEqual([]);
  });
  it('a clear new command during a "which one?" question runs instead of being swallowed', async () => {
    const r = await makeRig();
    await r.a.handle('Ahmed u dir hi', { source: 'text' });
    await r.a.handle('Notepad fur', { source: 'text' });
    expect(r.platform.launched).toEqual(['Notepad']);
  });
});

describe('review fix 3: the visitor consent notice must really be spoken before anything is recorded', () => {
  const inp = (mut?: (s: ReturnType<typeof defaultSettings>) => void) => {
    const settings = defaultSettings();
    mut?.(settings);
    return { owner: DEFAULT_OWNER, settings, recognitionConfidence: 0.2, recognitionState: 'unknown' as const };
  };
  const mk = async () => { const l = new VisitorLog(tmpDir(), testKeys()); await l.load(); return l; };
  it('TTS failure / cut-off notice => nothing is asked and nothing stored', async () => {
    let listened = false;
    const io: VisitorIO = { speak: async () => false, listen: async () => { listened = true; return { text: 'Magacaygu waa Cabdi' }; }, snapshot: async () => null };
    const ev = await runVisitorFlow(io, await mk(), inp(), new AbortController().signal);
    expect(listened).toBe(false);
    expect(ev).toMatchObject({ consent: 'not_asked', transcript: null, selfReportedName: null, noticeSpokenAt: null });
  });
  it('the notice (2nd sentence) failing is enough to refuse recording', async () => {
    let n = 0;
    let listened = false;
    const io: VisitorIO = { speak: async () => ++n === 1, listen: async () => { listened = true; return { text: 'x y z' }; }, snapshot: async () => null };
    const ev = await runVisitorFlow(io, await mk(), inp(), new AbortController().signal);
    expect(listened).toBe(false);
    expect(ev.consent).toBe('not_asked');
  });
  it('owner returns while the snapshot is being taken => no transcript, no media kept', async () => {
    const ctl = new AbortController();
    const log = await mk();
    const io: VisitorIO = { speak: async () => true, listen: async () => ({ text: 'Waxaan ahay Faadumo', audio: Buffer.from('a') }), snapshot: async () => { ctl.abort(); return Buffer.from('img'); } };
    const ev = await runVisitorFlow(io, log, inp((s) => { s.visitors.snapshot = 'disclosed'; s.visitors.saveAudio = true; }), ctl.signal);
    expect(ev).toMatchObject({ consent: 'interrupted', transcript: null, snapshotId: null, audioId: null });
    expect(await log.blobs.get(ev.id)).toBeNull();
  });
  it('a visitor saying "jooji" cannot stop anything (voice from an unrecognised person is ignored before stop handling)', async () => {
    const r = await makeRig({ settings: (s) => { s.camera.enabled = true; s.camera.stableFrames = 1; } });
    r.presence.push({ ts: 1, faces: [{ ownerSimilarity: 0.1, knownSimilarity: null, liveness: 0.9, qualityOk: true }], luminance: 0.5 });
    r.speech.stopped = 0;
    await r.a.handle('Jooji', { source: 'voice' });
    expect(r.speech.stopped).toBe(0);
  });
});

describe('review fix 4: stop/cancel reaches confirmed and follow-up actions', () => {
  it('stopAll during a confirmed send prevents the send', async () => {
    const r = await makeRig();
    await ask(r);
    r.wa.draftDelayMs = 150;
    const run = r.a.handle('haa', { source: 'text' });
    await new Promise((res) => setTimeout(res, 40));
    r.a.stopAll();
    await run;
    await new Promise((res) => setTimeout(res, 250));
    expect(r.wa.sent).toEqual([]);
  });
});

describe('review fix 5: "show on screen only" never speaks the private text', () => {
  it('stays silent but shows the text', async () => {
    const r = await makeRig({ settings: (s) => { s.camera.enabled = true; s.camera.stableFrames = 1; } });
    const owner = { ownerSimilarity: 0.95, knownSimilarity: null, liveness: 0.9, qualityOk: true };
    const other = { ownerSimilarity: 0.1, knownSimilarity: null, liveness: 0.9, qualityOk: true };
    r.presence.push({ ts: 1, faces: [owner, other], luminance: 0.5 });
    r.assurance.ownerFaceSeen(r.clock.t);
    await r.a.handle('Shaashadda akhri', { source: 'text' });
    expect(said(r).at(-1)).toContain('shaashadda kaliya');
    const before = said(r).length;
    await r.a.handle('haa', { source: 'text' });
    expect(said(r).length).toBe(before); // nothing spoken
    expect(r.events.some((e) => e.type === 'turn' && e.turn.role === 'assistant' && e.turn.text.includes('readable content'))).toBe(true);
  });
});

describe('review fix 6: sensitive confirmations name the target', () => {
  it('the prompt contains what will be deleted', async () => {
    const r = await makeRig();
    r.assurance.strongVerified(r.clock.t);
    r.provider.responses = [JSON.stringify({ steps: [{ tool: 'files.recycle', input: { path: 'C:\\Users\\Hassan\\Downloads\\taxes.xlsx' } }] })];
    await r.a.handle('tirtir samee hawshaas', { source: 'text' });
    expect(said(r).at(-1)).toContain('taxes.xlsx');
  });
});

describe('review fix 7: only safe document types are opened automatically', () => {
  it.each(['evil.hta', 'evil.wsf', 'evil.cpl', 'evil.url', 'evil.vbe', 'evil.exe.', 'evil.exe ', 'evil.pdf.exe', 'noext', 'evil.PS1'])('%s is refused', async (name) => {
    const r = await makeRig();
    const out = await r.a.executor.execute('files.open', { path: 'C:\\Users\\Hassan\\Downloads\\' + name }, new AbortController().signal);
    if (out.kind === 'done') expect(out.result.status).toBe('failed');
    expect(r.platform.opened).toEqual([]);
  });
  it('a normal document opens', async () => {
    const r = await makeRig();
    const out = await r.a.executor.execute('files.open', { path: 'C:\\Users\\Hassan\\Documents\\report.pdf' }, new AbortController().signal);
    expect(out.kind).toBe('done');
    expect(r.platform.opened).toEqual(['C:\\Users\\Hassan\\Documents\\report.pdf']);
  });
  it('a junction/symlink that resolves outside the approved folders is refused', async () => {
    const r = await makeRig();
    r.platform.realPath = (p: string) => (p.endsWith('link.pdf') ? 'C:\\Windows\\secret.pdf' : p);
    const out = await r.a.executor.execute('files.open', { path: 'C:\\Users\\Hassan\\Documents\\link.pdf' }, new AbortController().signal);
    if (out.kind === 'done') expect(out.result.status).toBe('failed');
    expect(r.platform.opened).toEqual([]);
  });
});

describe('review fix 8: the application allow-list applies to the resolved application', () => {
  it('"wordpad fur" is blocked when only Word is approved', async () => {
    const r = await makeRig({ settings: (s) => { s.permissions.appPolicy = 'allowlist'; s.permissions.approvedApps = ['word']; } });
    await r.a.handle('wordpad fur', { source: 'text' });
    expect(r.platform.launched).toEqual([]);
    await r.a.handle('Word fur', { source: 'text' });
    expect(r.platform.launched).toEqual(['Microsoft Word']);
  });
});

describe('review fix 9/10: parser', () => {
  const ctx = { wakeNames: ['afuufow'], hasPendingMessage: true };
  it.each([['read the screen', 'read_screen'], ['Shaashadda akhri', 'read_screen'], ['tirtir faylka invoice', 'chat'], ['ilaali Downloads', 'chat']])('with a pending message "%s" is not a message follow-up', (t) => {
    expect(parseCommand(t, ctx).intent.type).not.toBe('message_followup');
  });
  it('exact follow-ups still work', () => {
    expect(parseCommand('Fariinta ii akhri', ctx).intent).toEqual({ type: 'message_followup', action: 'read_pending' });
    expect(parseCommand('Fariinta diyaari, ha dirin.', ctx).intent).toEqual({ type: 'message_followup', action: 'draft_pending' });
    expect(parseCommand('tirtir', ctx).intent).toEqual({ type: 'message_followup', action: 'cancel_pending' });
  });
  it.each(['tell me, what time is it', 'message from Ahmed: hi', 'tell her, hello'])('"%s" is not a message to a person called me/from/her', (t) => {
    expect(parseCommand(t, { ...ctx, hasPendingMessage: false }).intent.type).not.toBe('whatsapp_message');
  });
  it('a stale draft is read back instead of being sent by a lone "dir"', async () => {
    const r = await makeRig();
    await r.a.handle('Hooyo u qor Waan imaanayaa, ha dirin', { source: 'text' });
    r.clock.t += 90_000;
    await r.a.handle('Dir', { source: 'text' });
    expect(r.wa.sent).toEqual([]);
    expect(said(r).at(-1)).toContain('Waan imaanayaa');
    await r.a.handle('haa', { source: 'text' });
    expect(r.wa.sent).toHaveLength(1);
  });
});

describe('review lows', () => {
  it.each([["I'm here to see Hassan", null], ['Waxaan ahay saaxiib', null], ['Magacaygu waa Cabdi', 'Cabdi']])('self-reported name from "%s"', (t, n) => expect(extractSelfReportedName(t)).toBe(n));
  it('the duplicate-send question can be answered "haa"', async () => {
    const r = await makeRig();
    await r.a.handle('Hooyo u dir Waan imaanayaa', { source: 'text' });
    await r.a.handle('Hooyo u dir Waan imaanayaa', { source: 'text' });
    expect(r.wa.sent).toHaveLength(1);
    await r.a.handle('haa', { source: 'text' });
    expect(r.wa.sent).toHaveLength(2);
  });
});
