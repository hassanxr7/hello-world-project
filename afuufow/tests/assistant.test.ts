import { describe, expect, it } from 'vitest';
import { FARIISO_RESPONSE, greetingPhrase } from '../src/shared/phrases';
import { type Rig, makeRig } from './helpers';

const said = (r: Rig) => r.speech.spoken;
const settle = () => new Promise((res) => setTimeout(res, 20));

describe('identity phrases', () => {
  it('greeting is exactly the required sentence', async () => {
    const r = await makeRig();
    expect(greetingPhrase(r.memory.owner)).toBe('Mudane Hassan Mohamed, Boss Hassan XR, waan taaganahay.');
  });
  it('"Fariiso." gets the exact required answer', async () => {
    const r = await makeRig();
    await r.a.handle('Fariiso.', { source: 'voice' });
    expect(said(r)).toEqual(['Waan fadhiistay Boss. Maxaan qabtaa? Shaqo ii dir.']);
    expect(said(r)[0]).toBe(FARIISO_RESPONSE);
  });
  it('greets on activation once, then only acknowledges (no repeated greeting)', async () => {
    const r = await makeRig();
    await r.a.onActivated();
    await r.a.onActivated();
    await r.a.onActivated();
    expect(said(r)).toEqual(['Mudane Hassan Mohamed, Boss Hassan XR, waan taaganahay.']);
    r.clock.t += 11 * 60_000;
    await r.a.onActivated();
    expect(said(r)).toHaveLength(2);
  });
  it('greets on face arrival, but not again within the cooldown', async () => {
    const r = await makeRig();
    await r.a.onOwnerArrived();
    await r.a.onOwnerArrived();
    expect(said(r).filter((x) => x.includes('waan taaganahay'))).toHaveLength(1);
    r.clock.t += 31 * 60_000;
    await r.a.onOwnerArrived();
    expect(said(r).filter((x) => x.includes('waan taaganahay'))).toHaveLength(2);
  });
  it('speaks the owner names stored in memory (persisted preference)', async () => {
    const r = await makeRig();
    r.memory.setOwner({ greetingName: 'Hassan M.', nickname: 'Boss' });
    await r.a.onActivated();
    expect(said(r)[0]).toBe('Mudane Hassan M., Boss, waan taaganahay.');
  });
});

describe('applications and verification', () => {
  it('"Chrome fur" opens Chrome and announces success only after seeing the window', async () => {
    const r = await makeRig();
    await r.a.handle('Afuufow, Chrome fur', { source: 'voice' });
    expect(r.platform.launched).toEqual(['Google Chrome']);
    expect(said(r)[0]).toBe('Waan furay Google Chrome.');
    expect(r.actionLog.list()[0]).toMatchObject({ tool: 'apps.open', status: 'verified' });
  });
  it('does NOT claim success when the window never appears', async () => {
    const r = await makeRig();
    r.platform.windowAppears = false;
    await r.a.handle('Chrome fur', { source: 'text' });
    expect(said(r)[0]).toContain('ma arko daaqaddiisa');
    expect(said(r)[0]).not.toMatch(/^Waan furay/);
    expect(r.actionLog.list()[0]!.status).toBe('unverified');
  });
  it('reports a missing application honestly', async () => {
    const r = await makeRig();
    await r.a.handle('Photoshop fur', { source: 'text' });
    expect(r.platform.launched).toEqual([]);
    expect(said(r)[0]).toContain('ma helin');
  });
  it('respects an application allow-list', async () => {
    const r = await makeRig({ settings: (s) => { s.permissions.appPolicy = 'allowlist'; s.permissions.approvedApps = ['notepad']; } });
    await r.a.handle('Chrome fur', { source: 'text' });
    await r.a.handle('Notepad fur', { source: 'text' });
    expect(r.platform.launched).toEqual(['Notepad']);
  });
  it('opens a known folder and an approved folder', async () => {
    const r = await makeRig();
    await r.a.handle('Downloads-ka fur', { source: 'text' });
    expect(r.platform.opened).toEqual(['C:\\Users\\Hassan\\Downloads']);
  });
  it('refuses files outside approved folders', async () => {
    const r = await makeRig();
    const out = await r.a.executor.execute('files.open', { path: 'C:\\Windows\\System32\\config\\SAM' }, new AbortController().signal);
    expect(out.kind).toBe('done');
    if (out.kind === 'done') expect(out.result.status).toBe('failed');
    expect(r.platform.opened).toEqual([]);
  });
  it('never opens executables even inside approved folders', async () => {
    const r = await makeRig();
    const out = await r.a.executor.execute('files.open', { path: 'C:\\Users\\Hassan\\Downloads\\setup.exe' }, new AbortController().signal);
    if (out.kind === 'done') expect(out.result.status).toBe('failed');
    expect(r.platform.opened).toEqual([]);
  });
  it('finds files only in approved folders', async () => {
    const r = await makeRig();
    r.platform.files = [{ path: 'C:\\Users\\Hassan\\Documents\\invoice-2026.pdf', name: 'invoice-2026.pdf', modified: 1, size: 1 }];
    await r.a.handle('Ii raadi file-ka invoice-ka', { source: 'text' });
    expect(said(r)[0]).toContain('invoice-2026.pdf');
  });
  it('web.open rejects non-http schemes', async () => {
    const r = await makeRig();
    const out = await r.a.executor.execute('web.open', { url: 'file:///C:/Windows/System32/cmd.exe' }, new AbortController().signal);
    if (out.kind === 'done') expect(out.result.status).toBe('failed');
    expect(r.platform.urls).toEqual([]);
  });
  it('external browser results are labelled unverified', async () => {
    const r = await makeRig();
    await r.a.handle('search google for python tutorials', { source: 'text' });
    expect(r.platform.urls[0]).toBe('https://www.google.com/search?q=python%20tutorials');
    expect(r.actionLog.list()[0]!.status).toBe('unverified');
  });
});

describe('volume and screenshots are verified by read-back', () => {
  it('lowers the volume and confirms the new level', async () => {
    const r = await makeRig();
    await r.a.handle('Codka hoos u dhig', { source: 'text' });
    expect(r.platform.volume.level).toBe(30);
    expect(said(r)[0]).toBe('Codka hadda waa 30%.');
  });
  it('does not claim a volume change that did not happen', async () => {
    const r = await makeRig();
    r.platform.volumeBroken = true;
    await r.a.handle('Codka kor u qaad', { source: 'text' });
    expect(said(r)[0]).toContain('ma isbeddelin');
  });
  it('screenshot', async () => {
    const r = await makeRig();
    await r.a.handle('Screenshot qaad', { source: 'text' });
    expect(said(r)[0]).toContain('shot.png');
  });
});

describe('YouTube', () => {
  it('plays a requested song and verifies playback', async () => {
    const r = await makeRig();
    await r.a.handle('Afuufow, gal YouTube oo ii shid heesta Believer', { source: 'voice' });
    expect(r.yt.played).toEqual(['abcdefghijk']);
    expect(said(r)[0]).toContain('Waan shiday');
  });
  it('reports an advertisement honestly', async () => {
    const r = await makeRig();
    r.yt.playback = { ...r.yt.playback, adShowing: true };
    await r.a.handle('ii shid heesta Believer', { source: 'text' });
    expect(said(r)[0]).toContain('xayeysiis');
  });
  it('asks a short clarification when the match is weak, then plays the chosen one', async () => {
    const r = await makeRig();
    r.yt.results = [
      { id: 'aaaaaaaaaaa', title: 'Song A live', channel: 'x', score: 0.4 },
      { id: 'bbbbbbbbbbb', title: 'Song A cover', channel: 'y', score: 0.38 },
    ];
    await r.a.handle('ii shid heesta Song A', { source: 'text' });
    expect(r.yt.played).toEqual([]);
    expect(said(r)[0]).toContain('Kee?');
    await r.a.handle('midka labaad', { source: 'text' });
    expect(r.yt.played).toEqual(['bbbbbbbbbbb']);
  });
  it('"Jooji muuqaalka" pauses and "Sii wad" resumes (verified through the player)', async () => {
    const r = await makeRig();
    await r.a.handle('ii shid heesta Believer', { source: 'text' });
    await r.a.handle('Jooji muuqaalka', { source: 'voice' });
    expect(r.yt.playback.paused).toBe(true);
    await r.a.handle('Sii wad', { source: 'voice' });
    expect(r.yt.playback.playing).toBe(true);
    expect(said(r).slice(-2)).toEqual(['Waan joojiyay.', 'Waan sii wadey.']);
  });
  it('without a controllable player the media key result is labelled unverified', async () => {
    const r = await makeRig();
    await r.a.handle('Jooji muuqaalka', { source: 'voice' });
    expect(r.platform.keys).toEqual(['playpause']);
    expect(said(r)[0]).toContain('ma xaqiijin karo');
  });
});

describe('WhatsApp', () => {
  it('"Ahmed u dir ..." with two Ahmeds asks which one, then sends to the chosen contact', async () => {
    const r = await makeRig();
    await r.a.handle('Ahmed u dir fariintan: ‘Si degdeg ah ii soo wac.’', { source: 'voice' });
    expect(r.wa.sent).toEqual([]);
    expect(said(r)[0]).toContain('Ahmed Ali');
    expect(said(r)[0]).toContain('Ahmed Jama');
    await r.a.handle('midka labaad', { source: 'voice' });
    expect(r.wa.sent).toEqual([{ phone: '252622222222', text: 'Si degdeg ah ii soo wac.' }]);
  });
  it('a full name resolves directly and the exact text is submitted', async () => {
    const r = await makeRig();
    await r.a.handle('WhatsApp-ka fur, Ahmed Ali u dir: “Si degdeg ah ii soo wac.”', { source: 'voice' });
    expect(r.wa.sent).toEqual([{ phone: '252611111111', text: 'Si degdeg ah ii soo wac.' }]);
    expect(said(r)[0]).toContain('waa la diray');
  });
  it('does not claim delivery when WhatsApp only shows "sent"', async () => {
    const r = await makeRig();
    await r.a.handle('Hooyo u dir Waan imaanayaa', { source: 'text' });
    expect(said(r)[0]).toContain('Wali lama xaqiijin inay gaartay');
    expect(said(r)[0]).not.toContain('la gaarsiiyay');
  });
  it('reports "delivered" only when the UI shows delivered', async () => {
    const r = await makeRig();
    r.wa.delivery = 'delivered';
    await r.a.handle('Hooyo u dir Waan imaanayaa', { source: 'text' });
    expect(said(r)[0]).toContain('la gaarsiiyay');
  });
  it('says so when the sent message cannot be found in the chat', async () => {
    const r = await makeRig();
    r.wa.showBubble = false;
    await r.a.handle('Hooyo u dir Waan imaanayaa', { source: 'text' });
    expect(said(r)[0]).toContain('ma arko fariinta');
    expect(r.actionLog.list()[0]!.status).toBe('unverified');
  }, 15000);
  it('draft mode types the message but does not send it', async () => {
    const r = await makeRig();
    await r.a.handle('Hooyo u qor Waan imaanayaa, ha dirin', { source: 'text' });
    expect(r.wa.composer).toBe('Waan imaanayaa');
    expect(r.wa.sent).toEqual([]);
    expect(said(r)[0]).toContain('mana dirin');
  });
  it('"u qor" prepares the message and asks once before sending; "haa" then sends', async () => {
    const r = await makeRig();
    await r.a.handle('Hooyo u qor Waan imaanayaa', { source: 'text' });
    expect(r.wa.sent).toEqual([]);
    expect(said(r).at(-1)).toBe('Ma dirayaa fariintan?');
    await r.a.handle('haa', { source: 'text' });
    expect(r.wa.sent).toEqual([{ phone: '252633333333', text: 'Waan imaanayaa' }]);
  });
  it('"maya" after the question sends nothing', async () => {
    const r = await makeRig();
    await r.a.handle('Hooyo u qor Waan imaanayaa', { source: 'text' });
    await r.a.handle('maya', { source: 'text' });
    expect(r.wa.sent).toEqual([]);
  });
  it('follow-up "dir" sends the prepared draft', async () => {
    const r = await makeRig();
    await r.a.handle('Hooyo u qor Waan imaanayaa, ha dirin', { source: 'text' });
    await r.a.handle('Dir', { source: 'text' });
    expect(r.wa.sent).toHaveLength(1);
  });
  it('fast-send: standing permission + fast mode sends on "u qor" without asking', async () => {
    const r = await makeRig({ settings: (s) => { s.permissions.messaging.mode = 'fast'; } });
    r.memory.upsertContact({ ...r.mum, fastSend: true });
    r.grants.setFastSend(r.mum.id, true);
    await r.a.handle('Hooyo u qor Waan imaanayaa', { source: 'text' });
    expect(r.wa.sent).toHaveLength(1);
    expect(r.actionLog.list()[0]).toMatchObject({ decidedBy: 'standing-permission' });
    expect(said(r).some((t) => t.includes('Ma dirayaa'))).toBe(false);
  });
  it('revoking the standing permission restores the confirmation', async () => {
    const r = await makeRig({ settings: (s) => { s.permissions.messaging.mode = 'fast'; } });
    r.memory.upsertContact({ ...r.mum, fastSend: true });
    r.grants.setFastSend(r.mum.id, true);
    r.grants.setFastSend(r.mum.id, false);
    await r.a.handle('Hooyo u qor Waan imaanayaa', { source: 'text' });
    expect(r.wa.sent).toEqual([]);
  });
  it('read-back mode reads the message first', async () => {
    const r = await makeRig();
    await r.a.handle('Hooyo u dir Waan imaanayaa, ii akhri ka hor intaadan dirin', { source: 'text' });
    expect(r.wa.sent).toEqual([]);
    expect(said(r)[0]).toContain('Fariinta waxay tahay: Waan imaanayaa');
    await r.a.handle('haa', { source: 'text' });
    expect(r.wa.sent).toHaveLength(1);
  });
  it('never sends to a name that is not an approved contact', async () => {
    const r = await makeRig();
    await r.a.handle('Zainab u dir Salaan', { source: 'text' });
    await r.a.handle('Stranger Sam u dir Salaan', { source: 'text' });
    expect(r.wa.sent).toEqual([]);
    expect(r.wa.chat).toBeNull();
  });
  it('does not send if the typed text does not match what was dictated', async () => {
    const r = await makeRig();
    r.wa.mangleComposer = true;
    await r.a.handle('Hooyo u dir Waan imaanayaa', { source: 'text' });
    expect(r.wa.sent).toEqual([]);
    expect(said(r)[0]).toContain('ma dirin');
  });
  it('asks to scan the QR code when WhatsApp is not linked', async () => {
    const r = await makeRig();
    r.wa.statusValue = 'qr_required';
    await r.a.handle('Hooyo u dir Waan imaanayaa', { source: 'text' });
    expect(r.wa.sent).toEqual([]);
    expect(said(r)[0]).toContain('QR');
  });
  it('requires owner presence to send when the camera is enabled', async () => {
    const r = await makeRig({ settings: (s) => { s.camera.enabled = true; } });
    await r.a.handle('Hooyo u dir Waan imaanayaa', { source: 'text' });
    expect(r.wa.sent).toEqual([]);
    r.assurance.ownerFaceSeen(r.clock.t);
    await r.a.handle('Hooyo u dir Waan imaanayaa', { source: 'text' });
    expect(r.wa.sent).toHaveLength(1);
  });
  it('refuses an identical message twice within a minute without asking', async () => {
    const r = await makeRig();
    await r.a.handle('Hooyo u dir Waan imaanayaa', { source: 'text' });
    await r.a.handle('Hooyo u dir Waan imaanayaa', { source: 'text' });
    expect(r.wa.sent).toHaveLength(1);
    expect(said(r).at(-1)).toContain('mar kale');
  });
});

describe('interruption and cancellation', () => {
  it('"Jooji" cancels a running task immediately and nothing is announced as done', async () => {
    const r = await makeRig();
    r.platform.windowDelayMs = 3000;
    const run = r.a.handle('Chrome fur', { source: 'voice' });
    await settle();
    expect(r.a.currentTask()).not.toBeNull();
    await r.a.handle('Jooji', { source: 'voice' });
    await run;
    expect(r.actionLog.list()[0]!.status).toBe('cancelled');
    expect(said(r).join(' ')).not.toContain('Waan furay');
    expect(r.a.currentTask()).toBeNull();
  });
  it('"Aamus" stops speech in progress', async () => {
    const r = await makeRig();
    r.speech.delayMs = 5000;
    const run = r.a.handle('Fariiso', { source: 'voice' });
    await settle();
    await r.a.handle('Aamus', { source: 'voice' });
    await run;
    expect(r.speech.stopped).toBeGreaterThan(0);
  });
  it('"Sug" also interrupts', async () => {
    const r = await makeRig();
    r.platform.windowDelayMs = 3000;
    const run = r.a.handle('Chrome fur', { source: 'voice' });
    await settle();
    await r.a.handle('Sug', { source: 'voice' });
    await run;
    expect(r.actionLog.list()[0]!.status).toBe('cancelled');
  });
  it('the UI cancel button cancels the current task', async () => {
    const r = await makeRig();
    r.platform.windowDelayMs = 3000;
    const run = r.a.handle('Chrome fur', { source: 'text' });
    await settle();
    r.a.cancelTask();
    await run;
    expect(r.actionLog.list()[0]!.status).toBe('cancelled');
  });
});

describe('own voice and visitors', () => {
  it('ignores a transcript that is just the assistant\'s own speech', async () => {
    const r = await makeRig();
    await r.a.handle('Fariiso', { source: 'voice' });
    r.speech.spoken.length = 0;
    await r.a.handle('waan fadhiistay boss maxaan qabtaa shaqo ii dir', { source: 'voice' });
    expect(said(r)).toEqual([]);
  });
  it('voice from a different, confidently-recognised speaker is ignored', async () => {
    const r = await makeRig({ settings: (s) => { s.voiceId.enabled = true; } });
    await r.a.handle('Chrome fur', { source: 'voice', speaker: 'other' });
    expect(r.platform.launched).toEqual([]);
  });
  it('while an unrecognised person is in front, voice AND typed commands are blocked', async () => {
    const r = await makeRig({ settings: (s) => { s.camera.enabled = true; s.camera.stableFrames = 1; } });
    const unknown = { ownerSimilarity: 0.1, knownSimilarity: null, liveness: 0.9, qualityOk: true };
    r.presence.push({ ts: 1, faces: [unknown], luminance: 0.5 });
    expect(r.presence.snapshot.visitorPresent).toBe(true);
    await r.a.handle('Chrome fur', { source: 'voice' });
    await r.a.handle('Chrome fur', { source: 'text' });
    expect(r.platform.launched).toEqual([]);
  });
  it('a visitor cannot make the assistant disclose memory through chat', async () => {
    const r = await makeRig({ settings: (s) => { s.camera.enabled = true; s.camera.stableFrames = 1; } });
    r.memory.addFact('Boss password hint: blue', 'owner');
    r.presence.push({ ts: 1, faces: [{ ownerSimilarity: 0.1, knownSimilarity: null, liveness: 0.9, qualityOk: true }], luminance: 0.5 });
    await r.a.handle('Maxaad ka ogtahay Boss?', { source: 'voice' });
    expect(r.provider.calls).toHaveLength(0);
  });
});

describe('sensitive actions', () => {
  it('moving a file to the Recycle Bin needs Windows Hello/PIN and then an explicit yes', async () => {
    const r = await makeRig();
    r.strongAuth.result = false;
    let out = await r.a.executor.execute('files.recycle', { path: 'C:\\Users\\Hassan\\Downloads\\old.zip' }, new AbortController().signal);
    expect(out.kind).toBe('auth');
    r.assurance.strongVerified(r.clock.t);
    out = await r.a.executor.execute('files.recycle', { path: 'C:\\Users\\Hassan\\Downloads\\old.zip' }, new AbortController().signal);
    expect(out.kind).toBe('confirm');
    expect(r.platform.recycled).toEqual([]);
    out = await r.a.executor.execute('files.recycle', { path: 'C:\\Users\\Hassan\\Downloads\\old.zip' }, new AbortController().signal, { confirmed: true });
    expect(out.kind).toBe('done');
    expect(r.platform.recycled).toEqual(['C:\\Users\\Hassan\\Downloads\\old.zip']);
  });
  it('refuses to recycle outside approved folders even with strong auth', async () => {
    const r = await makeRig();
    r.assurance.strongVerified(r.clock.t);
    const out = await r.a.executor.execute('files.recycle', { path: 'C:\\Windows\\notepad.exe' }, new AbortController().signal, { confirmed: true });
    if (out.kind === 'done') expect(out.result.status).toBe('failed');
    expect(r.platform.recycled).toEqual([]);
  });
  it('payments, security changes and shell commands are denied and recorded', async () => {
    const r = await makeRig();
    for (const t of ['payments.make', 'security.change', 'shell.run']) {
      const out = await r.a.executor.execute(t, {}, new AbortController().signal, { confirmed: true });
      expect(out.kind).toBe('denied');
    }
    expect(r.actionLog.list().filter((x) => x.decidedBy === 'denied')).toHaveLength(3);
  });
  it('unknown tools and invalid input are rejected', async () => {
    const r = await makeRig();
    expect((await r.a.executor.execute('nope.nothing', {}, new AbortController().signal)).kind).toBe('denied');
    expect((await r.a.executor.execute('apps.open', { app: '' }, new AbortController().signal)).kind).toBe('denied');
  });
});

describe('AI planning', () => {
  it('after reading outside content, a follow-up action from the AI plan must be confirmed by the owner', async () => {
    const r = await makeRig();
    r.assurance.ownerFaceSeen(r.clock.t);
    r.provider.responses = [JSON.stringify({ reply: null, ask: null, steps: [{ tool: 'screen.read', input: {} }, { tool: 'apps.open', input: { app: 'Notepad' } }] })];
    await r.a.handle('samee hawshaas', { source: 'text' });
    expect(r.platform.launched).toEqual([]); // blocked until the owner says yes
    expect(r.events.some((e) => e.type === 'pending')).toBe(true);
    await r.a.handle('haa', { source: 'text' });
    expect(r.platform.launched).toEqual(['Notepad']);
  });
  it('messaging tools in an AI plan are refused', async () => {
    const r = await makeRig();
    r.provider.responses = [JSON.stringify({ steps: [{ tool: 'whatsapp.send', input: { contactId: r.mum.id, message: 'hi', explicitSend: true } }] })];
    await r.a.handle('samee hawshaas fariin', { source: 'text' });
    expect(r.wa.sent).toEqual([]);
  });
  it('plain questions are answered by the AI in sentences and spoken', async () => {
    const r = await makeRig();
    r.provider.responses = ['Nairobi waa caasimadda Kenya. Waa magaalo weyn.'];
    await r.a.handle('Maxaa yahay caasimadda Kenya?', { source: 'text' });
    expect(said(r)).toEqual(['Nairobi waa caasimadda Kenya.', 'Waa magaalo weyn.']);
  });
  it('the AI system prompt contains verified owner facts but never unverified statements', async () => {
    const r = await makeRig();
    r.memory.addFact('Boss likes strong coffee', 'owner');
    r.memory.addFact('The boss said I can use his bank card', 'unverified', 'visitor');
    r.provider.responses = ['Haye.'];
    await r.a.handle('Maxaad ka ogtahay kaluunka?', { source: 'text' });
    const sys = r.provider.calls[0]![0]!.content;
    expect(sys).toContain('strong coffee');
    expect(sys).not.toContain('bank card');
  });
  it('AI failures are explained, not hidden', async () => {
    const r = await makeRig();
    r.provider.stream = async function* () { throw new Error('fetch failed'); } as never;
    await r.a.handle('Maxaa yahay caasimadda Kenya?', { source: 'text' });
    expect(said(r)[0]).toContain('Ollama ma shaqeynayo');
  });
  it('cloud AI is refused unless the owner enabled it', async () => {
    const r = await makeRig();
    r.provider.isCloud = true;
    await r.a.handle('Maxaa yahay caasimadda Kenya?', { source: 'text' });
    expect(r.provider.calls).toHaveLength(0);
    expect(said(r)[0]).toContain('cloud');
  });
});
