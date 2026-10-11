import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Assistant, type AssistantDeps } from '../src/core/assistant/assistant';
import type { AssistantEvent, SpeechOut } from '../src/core/assistant/types';
import { type Settings, defaultSettings } from '../src/core/config/settings';
import { LlmRouter } from '../src/core/llm/client';
import type { ChatMessage, LlmProvider } from '../src/core/llm/providers';
import { MemoryStore } from '../src/core/memory/memory';
import { AssuranceManager } from '../src/core/permissions/assurance';
import { GrantStore } from '../src/core/permissions/grants';
import type { FoundFile, InstalledApp, Platform, WaDelivery, WaStatus, WhatsAppController, WindowInfo, YouTubeController, YtCandidate, YtPlayback } from '../src/core/platform';
import { StaticKeyProvider } from '../src/core/storage/encrypted';
import { SelfSpeechFilter } from '../src/core/speech/selfecho';
import { ActionLog } from '../src/core/tools/actionlog';
import { buildRegistry } from '../src/core/tools';
import type { Services } from '../src/core/tools/services';
import { GreetingPolicy, PresenceTracker } from '../src/core/vision/presence';
import { VisitorLog } from '../src/core/visitors/log';
import type { Contact } from '../src/shared/types';

export function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'afuufow-test-'));
}
export const testKeys = () => new StaticKeyProvider(randomBytes(32));

export class FakePlatform implements Platform {
  apps: InstalledApp[] = [
    { name: 'Google Chrome', id: 'C:\\Program Files\\Google\\Chrome\\chrome.exe', kind: 'exe' },
    { name: 'Visual Studio Code', id: 'C:\\Code\\Code.exe', kind: 'exe' },
    { name: 'Notepad', id: 'notepad.exe', kind: 'exe' },
    { name: 'WhatsApp', id: 'wa', kind: 'uwp' },
    { name: 'Microsoft Word', id: 'C:\\Office\\WINWORD.EXE', kind: 'exe' },
    { name: 'WordPad', id: 'C:\\Win\\wordpad.exe', kind: 'exe' },
  ];
  launched: string[] = [];
  windowAppears = true;
  windowDelayMs = 0;
  opened: string[] = [];
  urls: string[] = [];
  files: FoundFile[] = [];
  existing = new Set<string>();
  volume = { level: 40, muted: false };
  keys: string[] = [];
  clip = '';
  recycled: string[] = [];
  volumeBroken = false;
  async listApps() { return this.apps; }
  async launchApp(a: InstalledApp) { this.launched.push(a.name); }
  async waitForWindow(needles: string[], _t?: number, signal?: AbortSignal): Promise<WindowInfo | null> {
    if (this.windowDelayMs) await new Promise<void>((r) => { const t = setTimeout(r, this.windowDelayMs); signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });
    return this.windowAppears ? { title: needles[0]!, processName: needles[0]!, pid: 1 } : null;
  }
  async foregroundWindow() { return null; }
  knownFolder(l: string) { return `C:\\Users\\Hassan\\${l[0]!.toUpperCase()}${l.slice(1)}`; }
  pathExists(p: string) { return this.existing.has(p) || p.startsWith('C:\\Users\\Hassan\\') && !this.recycled.includes(p) && !p.endsWith('missing'); }
  realPath(p: string) { return p; }
  async openPath(p: string) { this.opened.push(p); }
  async openUrl(u: string) { this.urls.push(u); }
  async findFiles(): Promise<FoundFile[]> { return this.files; }
  async screenshot(dir: string) { return { path: dir + '\\shot.png', bytes: 50000 }; }
  async getVolume() { return { ...this.volume }; }
  async setVolume(l: number) { if (!this.volumeBroken) this.volume.level = l; }
  async setMute(m: boolean) { if (!this.volumeBroken) this.volume.muted = m; }
  async mediaKey(k: string) { this.keys.push(k); }
  async clipboardWrite(t: string) { this.clip = t; }
  async clipboardRead() { return this.clip; }
  async focusWindow() { return true; }
  async sendPaste() { /* noop */ }
  async focusedText() { return this.clip; }
  async windowText() { return 'Hello from the window: this text is long enough to count as readable content.'; }
  async ocr() { return ''; }
  async recycle(p: string) { this.recycled.push(p); }
  async wingetInstall() { return { ok: true, output: '' }; }
  async wingetHas() { return true; }
}

export class FakeYouTube implements YouTubeController {
  results: YtCandidate[] = [{ id: 'abcdefghijk', title: 'Believer - Imagine Dragons', channel: 'ImagineDragonsVEVO', score: 0.95 }];
  playback: YtPlayback = { playing: true, paused: false, adShowing: false, title: 'Believer - Imagine Dragons', position: 2.1, volume: 1 };
  played: string[] = [];
  active = false;
  async search() { return this.results; }
  async play(id: string) { this.played.push(id); this.active = true; return this.playback; }
  async control(a: string) {
    if (a === 'pause') this.playback = { ...this.playback, playing: false, paused: true };
    if (a === 'resume') this.playback = { ...this.playback, playing: true, paused: false };
    return this.playback;
  }
  async status() { return this.active ? this.playback : null; }
}

export class FakeWhatsApp implements WhatsAppController {
  caps = { verifyComposer: true, canSend: true, verifyDelivery: true };
  statusValue: WaStatus = 'ready';
  chat: string | null = null;
  composer = '';
  sent: Array<{ phone: string; text: string }> = [];
  delivery: WaDelivery = 'sent';
  failSend = false;
  mangleComposer = false;
  draftDelayMs = 0;
  showBubble = true;
  async status() { return this.statusValue; }
  async show() { /* noop */ }
  async openChat(phone: string) { this.chat = phone; return { ok: true }; }
  async setDraft(text: string) { if (this.draftDelayMs) await new Promise((r) => setTimeout(r, this.draftDelayMs)); this.composer = this.mangleComposer ? text.toUpperCase() : text; return { ok: true, observed: this.composer }; }
  async clickSend() {
    if (this.failSend) return { ok: false };
    this.sent.push({ phone: this.chat!, text: this.composer });
    this.composer = '';
    return { ok: true };
  }
  async findOutgoing(text: string) {
    const f = this.showBubble && this.sent.some((s) => s.text === text);
    return { found: f, delivery: f ? this.delivery : ('unknown' as WaDelivery) };
  }
}

export class ScriptedProvider implements LlmProvider {
  readonly id = 'ollama' as const;
  isCloud = false;
  calls: ChatMessage[][] = [];
  constructor(public responses: string[] = ['Waan ku salaamayaa Boss.']) {}
  async *stream(messages: ChatMessage[]) {
    this.calls.push(messages);
    const r = this.responses.length > 1 ? this.responses.shift()! : this.responses[0]!;
    for (const part of r.match(/.{1,12}/gs) ?? []) yield part;
  }
  async ping() { return { ok: true, detail: 'fake' }; }
}

export class FakeSpeech implements SpeechOut {
  spoken: string[] = [];
  stopped = 0;
  delayMs = 0;
  private timers = new Set<() => void>();
  async speak(text: string, signal?: AbortSignal) {
    this.spoken.push(text);
    if (this.delayMs > 0) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(done, this.delayMs);
        const self = this;
        function done() { clearTimeout(t); self.timers.delete(done); signal?.removeEventListener('abort', done); resolve(); }
        this.timers.add(done);
        signal?.addEventListener('abort', done, { once: true });
      });
    }
  }
  stop() { this.stopped++; for (const f of [...this.timers]) f(); }
}

export interface Rig {
  a: Assistant;
  dir: string;
  settings: Settings;
  platform: FakePlatform;
  yt: FakeYouTube;
  wa: FakeWhatsApp;
  provider: ScriptedProvider;
  speech: FakeSpeech;
  memory: MemoryStore;
  visitorLog: VisitorLog;
  assurance: AssuranceManager;
  presence: PresenceTracker;
  grants: GrantStore;
  actionLog: ActionLog;
  events: AssistantEvent[];
  ahmedAli: Contact;
  ahmedJama: Contact;
  mum: Contact;
  strongAuth: { result: boolean; calls: number };
  clock: { t: number };
  services: Services;
}

export async function makeRig(opts: { settings?: (s: Settings) => void; contacts?: boolean; agent?: import('../src/core/agent/runner').AgentRunner } = {}): Promise<Rig> {
  const dir = tmpDir();
  const keys = testKeys();
  const settings = defaultSettings();
  settings.integrations.whatsapp.enabled = true;
  settings.permissions.approvedFolders = [{ label: 'downloads', path: 'C:\\Users\\Hassan\\Downloads' }, { label: 'documents', path: 'C:\\Users\\Hassan\\Documents' }];
  settings.general.welcomeMessage = ''; // spec tests assert the short required greeting
  opts.settings?.(settings);
  const clock = { t: 1_800_000_000_000 };
  const memory = new MemoryStore(dir, keys);
  await memory.load();
  const visitorLog = new VisitorLog(dir, keys);
  await visitorLog.load();
  const actionLog = new ActionLog(dir, keys);
  await actionLog.load();
  const grants = new GrantStore(dir, keys);
  await grants.load();
  const assurance = new AssuranceManager({ presenceTtlMs: 120_000, voiceTtlMs: 60_000, strongTtlMs: 300_000 }, () => clock.t);
  const presence = new PresenceTracker(settings.camera);
  const platform = new FakePlatform();
  const yt = new FakeYouTube();
  const wa = new FakeWhatsApp();
  const provider = new ScriptedProvider();
  const llm = new LlmRouter(() => settings, () => provider);
  const speech = new FakeSpeech();
  const events: AssistantEvent[] = [];
  const strongAuth = { result: true, calls: 0 };

  const ahmedAli = memory.upsertContact({ displayName: 'Ahmed Ali', aliases: ['Axmed Cali'], phone: '252611111111', approved: true, fastSend: false });
  const ahmedJama = memory.upsertContact({ displayName: 'Ahmed Jama', aliases: [], phone: '252622222222', approved: true, fastSend: false });
  const mum = memory.upsertContact({ displayName: 'Hooyo', aliases: ['Mum', 'Hooyo'], phone: '252633333333', approved: true, fastSend: false });
  memory.upsertContact({ displayName: 'Stranger Sam', aliases: [], phone: '252644444444', approved: false, fastSend: false });

  const services: Services = {
    platform, youtube: yt, whatsapp: wa, llm, memory, settings: () => settings, agent: opts.agent,
    screenshotDir: 'C:\\Users\\Hassan\\Pictures\\Afuufow', state: { lastDraft: '', lastSent: null },
  };
  const registry = buildRegistry(services, (id) => memory.contacts.find((c) => c.id === id));

  const deps: AssistantDeps = {
    settings: () => settings,
    patchSettings: (p) => Object.assign(settings.general, p),
    memory, registry, actionLog, visitorLog, assurance,
    presence: () => presence.snapshot,
    grants: () => grants.list(clock.t),
    llm, speech, echo: new SelfSpeechFilter(20_000, () => clock.t),
    greeting: new GreetingPolicy(() => ({ faceCooldownMs: 30 * 60_000, activationCooldownMs: 10 * 60_000 }), () => clock.t),
    emit: (e) => events.push(e),
    requestStrongAuth: async () => { strongAuth.calls++; return strongAuth.result; },
    awaitPresence: async () => assurance.atLeast('presence'),
    now: () => clock.t,
  };
  const a = new Assistant(deps);
  return { a, dir, settings, platform, yt, wa, provider, speech, memory, visitorLog, assurance, presence, grants, actionLog, events, ahmedAli, ahmedJama, mum, strongAuth, clock, services };
}
