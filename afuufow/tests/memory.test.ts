import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultSettings, loadSettings } from '../src/core/config/settings';
import { MemoryStore } from '../src/core/memory/memory';
import { EncryptedJsonFile, StaticKeyProvider } from '../src/core/storage/encrypted';
import { SecretStore } from '../src/core/storage/secrets';
import { sentences } from '../src/core/llm/client';
import { SelfSpeechFilter } from '../src/core/speech/selfecho';
import { testKeys, tmpDir } from './helpers';

describe('persistent memory', () => {
  it('owner identity, contacts, preferences and facts survive a restart', async () => {
    const dir = tmpDir();
    const keys = testKeys();
    const m1 = new MemoryStore(dir, keys);
    await m1.load();
    m1.setOwner({ fullName: 'Hassan Mohamed Mohamud', greetingName: 'Hassan Mohamed', nickname: 'Boss Hassan XR', language: 'so' });
    m1.setPreference('voice', 'male-somali');
    m1.addFavoriteApp('Google Chrome');
    m1.addFavoriteFolder({ label: 'projects', path: 'C:\\Projects' });
    m1.upsertContact({ displayName: 'Ahmed Ali', aliases: ['Axmed'], phone: '+252 61 111 1111', approved: true, fastSend: false });
    m1.addFact('Prefers short answers', 'owner');
    m1.addTurn({ role: 'owner', text: 'Fariiso', source: 'voice' });
    await m1.flush();

    const m2 = new MemoryStore(dir, keys);
    expect(await m2.load()).toBeNull();
    expect(m2.owner).toEqual({ fullName: 'Hassan Mohamed Mohamud', greetingName: 'Hassan Mohamed', nickname: 'Boss Hassan XR' });
    expect(m2.doc.preferences.voice).toBe('male-somali');
    expect(m2.doc.favorites.apps).toEqual(['Google Chrome']);
    expect(m2.doc.favorites.folders[0]!.path).toBe('C:\\Projects');
    expect(m2.contacts[0]).toMatchObject({ displayName: 'Ahmed Ali', phone: '252611111111' });
    expect(m2.ownerFacts().map((f) => f.text)).toEqual(['Prefers short answers']);
    expect(m2.recentTurns(5)[0]!.text).toBe('Fariiso');
  });
  it('the data on disk is encrypted (no plain text)', async () => {
    const dir = tmpDir();
    const m = new MemoryStore(dir, testKeys());
    await m.load();
    m.addFact('SECRET-TOKEN-12345', 'owner');
    await m.flush();
    const raw = fs.readFileSync(path.join(dir, 'memory.afu'));
    expect(raw.toString('latin1')).not.toContain('SECRET-TOKEN');
    expect(raw.subarray(0, 4).toString()).toBe('AFU1');
  });
  it('a wrong key cannot read it and the app starts with empty memory plus a visible error', async () => {
    const dir = tmpDir();
    const m = new MemoryStore(dir, testKeys());
    await m.load();
    m.addFact('x', 'owner');
    await m.flush();
    const other = new MemoryStore(dir, testKeys());
    const err = await other.load();
    expect(err).toBeTruthy();
    expect(other.doc.facts).toEqual([]);
  });
  it('tampered files are rejected (authenticated encryption)', async () => {
    const dir = tmpDir();
    const keys = testKeys();
    const m = new MemoryStore(dir, keys);
    await m.load();
    m.addFact('x', 'owner');
    await m.flush();
    const f = path.join(dir, 'memory.afu');
    const b = fs.readFileSync(f);
    b[b.length - 1]! ^= 1;
    fs.writeFileSync(f, b);
    fs.rmSync(f + '.bak', { force: true });
    const m2 = new MemoryStore(dir, keys);
    expect(await m2.load()).toBeTruthy();
    expect(m2.doc.facts).toEqual([]);
  });
  it('recovers from the backup when the main file is damaged', async () => {
    const dir = tmpDir();
    const keys = testKeys();
    const m = new MemoryStore(dir, keys);
    await m.load();
    m.addFact('first', 'owner');
    await m.flush();
    m.addFact('second', 'owner');
    await m.flush();
    fs.writeFileSync(path.join(dir, 'memory.afu'), 'garbage');
    const m2 = new MemoryStore(dir, keys);
    const err = await m2.load();
    expect(err).toContain('backup');
    expect(m2.doc.facts.length).toBeGreaterThanOrEqual(1);
  });
  it('keeps verified owner facts separate from unverified statements', async () => {
    const m = new MemoryStore(tmpDir(), testKeys());
    await m.load();
    m.addFact('Owner works at X', 'owner');
    m.addFact('A visitor says they are the owner\'s cousin', 'unverified', 'visitor');
    expect(m.ownerFacts()).toHaveLength(1);
    expect(m.unverifiedFacts()).toHaveLength(1);
    expect(m.ownerFacts()[0]!.text).not.toContain('cousin');
  });
  it('facts can be corrected, deleted, exported and wiped', async () => {
    const m = new MemoryStore(tmpDir(), testKeys());
    await m.load();
    const f = m.addFact('Lives in Hargeisa', 'owner');
    expect(m.correctFact(f.id, 'Lives in Mogadishu')).toBe(true);
    expect(JSON.parse(m.exportAll()).facts[0].text).toBe('Lives in Mogadishu');
    expect(m.deleteFact(f.id)).toBe(true);
    expect(m.doc.facts).toEqual([]);
    m.addFact('again', 'owner');
    await m.flush();
    await m.wipeAll();
    expect(m.doc.facts).toEqual([]);
  });
  it('retention prunes old conversation history; 0 days keeps nothing', async () => {
    const m = new MemoryStore(tmpDir(), testKeys());
    await m.load();
    const now = Date.now();
    m.addTurn({ role: 'owner', text: 'old', at: now - 40 * 86_400_000 });
    m.addTurn({ role: 'owner', text: 'new', at: now - 1000 });
    expect(m.prune(now, 30)).toBe(1);
    expect(m.doc.history.map((t) => t.text)).toEqual(['new']);
    m.prune(now, 0);
    expect(m.doc.history).toEqual([]);
  });
});

describe('secrets', () => {
  const cipher = (available = true) => ({
    available: () => available,
    encrypt: (s: string) => Buffer.from('ENC:' + Buffer.from(s).toString('hex')),
    decrypt: (b: Buffer) => Buffer.from(b.toString().slice(4), 'hex').toString(),
  });
  it('stores only ciphertext and round-trips', () => {
    const dir = tmpDir();
    const s = new SecretStore(dir, cipher());
    s.set('azure.speech.key', 'my-very-secret-key');
    expect(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8')).not.toContain('my-very-secret-key');
    expect(new SecretStore(dir, cipher()).get('azure.speech.key')).toBe('my-very-secret-key');
  });
  it('refuses to store a secret when the OS store is unavailable', () => {
    expect(() => new SecretStore(tmpDir(), cipher(false)).set('k', 'v')).toThrow(/plain text/);
  });
});

describe('settings', () => {
  it('defaults are valid and the owner-requested defaults hold', () => {
    const d = defaultSettings();
    expect(loadSettings(d).error).toBeUndefined();
    expect(d.general.speechLanguage).toBe('so');
    expect(d.audio.wakeWord).toBe('Afuufow');
    expect(d.providers.tts.azureVoice).toBe('so-SO-MuuseNeural');
    expect(d.camera.enabled).toBe(false);
    expect(d.audio.micEnabled).toBe(false);
    expect(d.privacy.allowCloudLlm).toBe(false);
  });
  it('merges partial stored settings over defaults and rejects invalid values', () => {
    expect(loadSettings({ general: { theme: 'light' } }).settings.general.theme).toBe('light');
    const bad = loadSettings({ camera: { fps: 99 } });
    expect(bad.error).toContain('camera.fps');
    expect(bad.settings.camera.fps).toBe(2);
  });
});

describe('sentence chunking for streaming speech', () => {
  async function collect(parts: string[]) {
    async function* gen() { for (const p of parts) yield p; }
    const out: string[] = [];
    for await (const s of sentences(gen())) out.push(s);
    return out;
  }
  it('emits sentences as soon as they are complete', async () => {
    expect(await collect(['Nairobi waa ', 'caasimadda. Waa ', 'weyn! Haye', '.'])).toEqual(['Nairobi waa caasimadda.', 'Waa weyn!', 'Haye.']);
  });
  it('does not split decimals', async () => {
    expect(await collect(['Waa 3.5 kiilo oo ', 'culus.'])).toEqual(['Waa 3.5 kiilo oo culus.']);
  });
});

describe('echo (self-speech) filter', () => {
  it('flags our own words while speaking and just after', () => {
    const c = { t: 1000 };
    const f = new SelfSpeechFilter(20_000, () => c.t);
    f.noteSpeaking('Waan fadhiistay Boss. Maxaan qabtaa?', 3000);
    expect(f.isEcho('waan fadhiistay boss')).toBe(true);
    f.speechEnded();
    c.t += 5000;
    expect(f.isEcho('waan fadhiistay boss maxaan qabtaa')).toBe(true);
  });
  it('does not flag a real command', () => {
    const f = new SelfSpeechFilter();
    f.noteSpeaking('Waan fadhiistay Boss.', 2000);
    expect(f.isEcho('Chrome fur')).toBe(false);
    expect(f.isEcho('Jooji')).toBe(false);
  });
  it('forgets old speech', () => {
    const c = { t: 0 };
    const f = new SelfSpeechFilter(1000, () => c.t);
    f.noteSpeaking('Waan fadhiistay Boss maxaan qabtaa', 100);
    c.t = 60_000;
    expect(f.isEcho('waan fadhiistay boss maxaan qabtaa')).toBe(false);
  });
});

describe('encrypted file primitives', () => {
  it('rejects keys of the wrong size', () => expect(() => new StaticKeyProvider(randomBytes(16))).toThrow());
  it('flush is atomic and destroy removes every trace', async () => {
    const dir = tmpDir();
    const f = new EncryptedJsonFile<{ a: number }>(path.join(dir, 'x.afu'), testKeys(), () => ({ a: 0 }));
    await f.load();
    f.update((d) => { d.a = 5; });
    await f.flush();
    expect(fs.existsSync(path.join(dir, 'x.afu'))).toBe(true);
    await f.destroy();
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
