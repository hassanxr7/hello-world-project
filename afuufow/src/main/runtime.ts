import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { app, clipboard, desktopCapturer, powerMonitor, screen, shell, systemPreferences } from 'electron';
import { Assistant } from '../core/assistant/assistant';
import type { AssistantEvent, SpeakerMatch } from '../core/assistant/types';
import type { Settings } from '../core/config/settings';
import { LlmRouter } from '../core/llm/client';
import { buildProvider } from '../core/llm/providers';
import { MemoryStore } from '../core/memory/memory';
import { parseCommand } from '../core/nlu/parser';
import { AssuranceManager } from '../core/permissions/assurance';
import { GrantStore } from '../core/permissions/grants';
import { PinLimiter, hashPin, validPinFormat, verifyPinHash } from '../core/permissions/pin';
import type { LlmClient, Platform } from '../core/platform';
import { floatToInt16, pcmToWav } from '../core/speech/audio';
import { type MlBackend, type PipelineEvents, VoicePipeline } from '../core/speech/pipeline';
import { SelfSpeechFilter } from '../core/speech/selfecho';
import { AzureSttProvider } from '../core/speech/stt/azure';
import { LocalSttProvider } from '../core/speech/stt/local';
import { OpenAISttProvider } from '../core/speech/stt/openai';
import { SttRouter, sttErrorMessage } from '../core/speech/stt/router';
import { AzureTtsProvider } from '../core/speech/tts/azure';
import { SpeechEngine } from '../core/speech/tts/engine';
import { SapiTtsProvider } from '../core/speech/tts/sapi';
import { EncryptedBlobDir } from '../core/storage/encrypted';
import { SECRET, SecretStore } from '../core/storage/secrets';
import { ActionLog } from '../core/tools/actionlog';
import { buildRegistry } from '../core/tools';
import type { Services } from '../core/tools/services';
import { FaceEnrollment, FaceStore } from '../core/vision/faces';
import { GreetingPolicy, PresenceTracker } from '../core/vision/presence';
import { VoiceEnrollment, VoiceStore, judgeVoice } from '../core/voiceid/voiceid';
import { VisitorGate, type VisitorIO, runVisitorFlow } from '../core/visitors/flow';
import { VisitorLog } from '../core/visitors/log';
import { uid } from '../core/util';
import type { DeviceStatus, DiagnosticItem, EnrollUpdate, IpcEvents, Snapshot } from '../shared/ipc';
import { DpapiKeyProvider, safeStorageCipher } from './keys';
import type { Logger } from './logger';
import { MlClient } from './ml-client';
import { MODELS, ModelManager } from './models';
import { SettingsStore } from './settings-store';
import { type MediaStatus, AudioBridge, VisionBridge } from './workers';
import { runJson, runPowerShell } from './windows/ps';
import { WindowsPlatform } from './windows/platform';
import { SCRIPTS, withParams } from './windows/scripts';
import { WhatsAppDesktop } from './whatsapp/desktop';
import { ElectronPageDriver } from './whatsapp/electron-driver';
import { WhatsAppWeb } from './whatsapp/web';
import { YouTubePlayer } from './youtube/player';

export interface Hub {
  send<K extends keyof IpcEvents>(name: K, payload: IpcEvents[K]): void;
  showMainWindow(): void;
  updateTray(): void;
}

class UnsupportedPlatform {
  constructor() {
    return new Proxy(this, { get: () => async () => { throw new Error('This feature needs Windows 10/11'); } });
  }
}

const BIAS_PROMPT = 'Afuufow, Boss Hassan XR, Hassan Mohamed, WhatsApp, YouTube, Chrome, Downloads, Documents, fur, jooji, sug, aamus, fariiso';

export class Runtime {
  readonly settings: SettingsStore;
  readonly secrets: SecretStore;
  readonly memory: MemoryStore;
  readonly visitorLog: VisitorLog;
  readonly actionLog: ActionLog;
  readonly grants: GrantStore;
  readonly faces: FaceStore;
  readonly voice: VoiceStore;
  readonly models: ModelManager;
  readonly ml: MlClient;
  readonly audio = new AudioBridge();
  readonly vision = new VisionBridge();
  readonly assurance: AssuranceManager;
  readonly presence: PresenceTracker;
  readonly echo = new SelfSpeechFilter();
  readonly pageDriver = new ElectronPageDriver();
  assistant!: Assistant;
  pipeline!: VoicePipeline;
  speech!: SpeechEngine;
  sttRouter!: SttRouter;
  llm!: LlmRouter;
  platform!: Platform;
  services!: Services;

  private dataDir: string;
  private micCapturing = false;
  private camCapturing = false;
  private micPermission = 'unknown';
  private camPermission = 'unknown';
  private lastMicErr: string | null = null;
  private lastCamErr: string | null = null;
  private oneShot: { resolve: (p: Int16Array | null) => void; timer: NodeJS.Timeout } | null = null;
  private visitorCtl: AbortController | null = null;
  private visitorGate = new VisitorGate();
  private faceEnroll: FaceEnrollment | null = null;
  private enrollLabel: string | null = null;
  private voiceEnroll: VoiceEnrollment | null = null;
  private enrollTempCamera = false;
  private authWaiter: ((ok: boolean) => void) | null = null;
  private pinLimiter = new PinLimiter();
  private greetBeforeNext = false;
  private lastSttErrAt = 0;
  private lastPresenceSent = 0;
  private lastLevelSent = 0;
  private loadErrors: string[] = [];
  private timers: NodeJS.Timeout[] = [];
  private pttActive = false;
  private downloads = new Map<string, number>();

  constructor(
    private userData: string,
    private log: Logger,
    private hub: Hub,
    private startedInBackground: boolean,
  ) {
    this.dataDir = path.join(userData, 'data');
    fs.mkdirSync(this.dataDir, { recursive: true });
    const keys = new DpapiKeyProvider(this.dataDir);
    this.settings = new SettingsStore(this.dataDir);
    this.secrets = new SecretStore(this.dataDir, safeStorageCipher);
    this.memory = new MemoryStore(this.dataDir, keys);
    this.visitorLog = new VisitorLog(this.dataDir, keys);
    this.actionLog = new ActionLog(this.dataDir, keys);
    this.grants = new GrantStore(this.dataDir, keys);
    this.faces = new FaceStore(this.dataDir, keys);
    this.voice = new VoiceStore(this.dataDir, keys);
    this.models = new ModelManager(path.join(userData, 'models'));
    this.assurance = new AssuranceManager({ presenceTtlMs: 120_000, voiceTtlMs: 60_000, strongTtlMs: 300_000 });
    this.presence = new PresenceTracker(this.settings.get().camera);
    this.ml = new MlClient(this.models, log, () => this.settings.get().providers.stt.localModel.replace('whisper-', '') as 'small', () => this.settings.get().audio.vadThreshold, () => this.hub.send('snapshot', this.snapshot()));
  }

  // ====================================================================== init

  async init(): Promise<void> {
    const s0 = this.settings.load();
    if (this.settings.loadError) this.loadErrors.push('settings: ' + this.settings.loadError);
    for (const [name, p] of [
      ['memory', this.memory.load()],
      ['visitors', this.visitorLog.load()],
      ['actions', this.actionLog.load()],
      ['grants', this.grants.load()],
      ['faces', this.faces.load()],
      ['voice', this.voice.load()],
    ] as const) {
      try {
        const r = await p;
        if (typeof r === 'string' && r) this.loadErrors.push(`${name}: ${r}`);
      } catch (e) {
        this.loadErrors.push(`${name}: ${(e as Error).message}`);
        this.log.error('load ' + name, e);
      }
    }
    this.applySettingsToCore(s0);
    this.settings.onChange((s) => this.applySettingsToCore(s));

    this.platform = process.platform === 'win32'
      ? new WindowsPlatform(runPowerShell, {
          openExternal: (u) => shell.openExternal(u),
          openPath: (p) => shell.openPath(p),
          captureScreenPng: async () => {
            const d = screen.getPrimaryDisplay();
            const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
            const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
            const src = sources.find((x) => x.display_id === String(d.id)) ?? sources[0];
            if (!src) throw new Error('no screen source available');
            return src.thumbnail.toPNG();
          },
          clipboardWrite: (t) => clipboard.writeText(t),
          clipboardRead: () => clipboard.readText(),
          knownFolder: (n) => app.getPath(n === 'videos' ? 'videos' : n === 'music' ? 'music' : n === 'pictures' ? 'pictures' : n === 'documents' ? 'documents' : n === 'desktop' ? 'desktop' : 'downloads'),
        })
      : (new UnsupportedPlatform() as unknown as Platform);

    const get = (n: string) => this.secrets.get(n);
    this.llm = new LlmRouter(() => this.settings.get(), () => buildProvider(this.settings.get(), get));
    const youtube = new YouTubePlayer(() => get(SECRET.youtubeApiKey), () => this.settings.get().integrations.youtube.playIn, () => this.settings.get().integrations.youtube.useApi);
    const whatsapp = {
      get: () => (this.settings.get().integrations.whatsapp.mode === 'desktop' ? this.waDesktop : this.waWeb),
    };
    this.waWeb = new WhatsAppWeb(this.pageDriver);
    this.waDesktop = new WhatsAppDesktop((u) => shell.openExternal(u), async () => process.platform === 'win32');
    const waProxy = new Proxy({} as WhatsAppDesktop, {
      get: (_t, prop) => {
        const target = whatsapp.get() as unknown as Record<string | symbol, unknown>;
        const v = target[prop];
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    this.services = {
      platform: this.platform,
      youtube,
      whatsapp: waProxy,
      llm: this.llm as LlmClient,
      memory: this.memory,
      settings: () => this.settings.get(),
      screenshotDir: path.join(app.getPath('pictures'), 'Afuufow'),
      state: { lastDraft: '', lastSent: null },
    };
    const registry = buildRegistry(this.services, (id) => this.memory.contacts.find((c) => c.id === id));

    // ---- speech out
    const s = () => this.settings.get();
    this.speech = new SpeechEngine(
      s,
      () => ({
        azure: new AzureTtsProvider(s().providers.tts.azureRegion, s().providers.tts.azureVoice, () => get(SECRET.azureSpeechKey), () => s().providers.tts.rate),
        sapi: new SapiTtsProvider(runPowerShell, () => s().providers.tts.sapiVoiceHint),
      }),
      this.audio,
      (m) => this.log.info(`tts ${m.provider} ${m.chars} chars ${m.cached ? 'cached' : m.synthMs + ' ms'}`),
      (() => {
        const blobs = new EncryptedBlobDir(path.join(this.dataDir, 'tts-cache'), keysOf(this));
        return { get: (k: string) => blobs.get(k), put: async (k: string, d: Buffer) => void (await blobs.put(k, d)) };
      })(),
    );

    // ---- speech in
    this.sttRouter = new SttRouter(s, () => ({
      azure: new AzureSttProvider(s().providers.stt.azureRegion, () => get(SECRET.azureSpeechKey), s().providers.stt.azureLanguage),
      openai: new OpenAISttProvider(s().providers.stt.openaiBaseUrl, s().providers.stt.openaiModel, () => get(SECRET.openaiKey)),
      local: new LocalSttProvider(this.ml),
    }));

    // ---- assistant
    const greeting = new GreetingPolicy(() => ({ faceCooldownMs: s().camera.greetingCooldownMin * 60_000, activationCooldownMs: s().permissions.activationGreetingCooldownMin * 60_000 }));
    this.assistant = new Assistant({
      settings: s,
      patchSettings: (p) => void this.settings.update({ general: p }),
      memory: this.memory,
      registry,
      actionLog: this.actionLog,
      visitorLog: this.visitorLog,
      assurance: this.assurance,
      presence: () => this.presence.snapshot,
      grants: () => this.grants.list(),
      llm: this.llm,
      speech: this.speech,
      echo: this.echo,
      greeting,
      emit: (e) => this.onAssistantEvent(e),
      requestStrongAuth: (reason) => this.requestStrongAuth(reason),
      awaitPresence: (ms, signal) => this.awaitPresence(ms, signal),
    });
    this.actionLog.onChange((r) => this.hub.send('action', r));
    this.visitorLog.onChange(() => {
      this.hub.send('visitors-changed', null);
      this.hub.send('snapshot', this.snapshot());
    });

    // ---- microphone pipeline
    const ml: MlBackend = {
      vadAccept: (f) => this.ml.vadAccept(f),
      vadSpeaking: () => this.ml.vadSpeaking(),
      vadReset: () => this.ml.vadReset(),
      kwsAccept: (f) => this.ml.kwsAccept(f),
      transcribeLocal: async (pcm, lang) => {
        if (s().audio.wakeEngine === 'cloud' && s().privacy.allowCloudStt) return (await this.sttRouter.transcribe(pcm, { prompt: BIAS_PROMPT })).text;
        void lang;
        return this.ml.transcribeLocal(pcm, 'en');
      },
      hasLocalAsr: () => (s().audio.wakeEngine === 'cloud' && s().privacy.allowCloudStt) || this.ml.hasLocalAsr(),
      hasKws: () => this.ml.hasKws(),
    };
    const pev: PipelineEvents = {
      onMode: () => this.hub.updateTray(),
      onWake: (rest) => this.onWake(rest),
      onUtterance: (pcm, ctx) => void this.onUtterance(pcm, ctx),
      onNotice: (kind, detail) => this.onPipelineNotice(kind, detail),
      onLevel: (l) => this.sendLevel(l),
    };
    this.pipeline = new VoicePipeline(ml, s, this.echo, pev);
    this.audio.onFrame((f) => void this.pipeline.onFrame(f));
    this.audio.onStatus((st) => this.onAudioStatus(st));
    this.audio.onLevel((l) => this.hub.send('ttsLevel', l));
    this.audio.volume = s().audio.ttsVolume;

    // ---- camera pipeline
    this.vision.onFrame((f) => this.onFrame(f));
    this.vision.onStatus((st) => this.onCameraStatus(st));
    this.vision.onEnroll((m) => this.onEnrollSamples(m));

    await this.ml.start().catch((e) => this.log.error('ML start', e));
    this.registerPowerEvents();
    this.visitorLog.addSession({ at: Date.now(), kind: this.startedInBackground ? 'signin' : 'app_start', source: 'app', detail: this.startedInBackground ? 'Afuufow started after Windows sign-in' : 'Afuufow started manually' });
    void this.scanSecurityLog();
    this.prune();
    this.timers.push(setInterval(() => this.prune(), 6 * 3600_000));
    this.refreshPermissionStatus();

    // resume the state the owner left, but only after setup was completed
    if (s0.setupComplete) {
      if (s().audio.micEnabled) await this.setMic(true).catch((e) => this.log.warn('resume mic: ' + (e as Error).message));
      if (s().camera.enabled && this.faces.enrolled) await this.setCamera(true).catch((e) => this.log.warn('resume camera: ' + (e as Error).message));
    }
    this.updateAssistantPause();
  }

  hub_snapshot() {
    this.hub.send('snapshot', this.snapshot());
  }

  private waWeb!: WhatsAppWeb;
  private waDesktop!: WhatsAppDesktop;

  private applySettingsToCore(s: Settings) {
    this.presence?.configure(s.camera);
    this.assurance?.configure({ presenceTtlMs: s.camera.presenceTtlSec * 1000, strongTtlMs: s.permissions.strongAuth.ttlSec * 1000 });
    if (this.audio) this.audio.volume = s.audio.ttsVolume;
    this.pipeline?.refresh();
    this.hub?.updateTray();
  }

  private prune() {
    const r = this.settings.get().privacy.retention;
    const now = Date.now();
    this.memory.prune(now, r.historyDays);
    this.actionLog.prune(now, r.actionLogDays);
    this.visitorLog.prune(now, r.visitorDays, r.snapshotDays);
  }

  // ====================================================================== events to UI

  private onAssistantEvent(e: AssistantEvent) {
    switch (e.type) {
      case 'state': this.hub.send('state', e.state); this.hub.updateTray(); break;
      case 'turn': this.hub.send('turn', e.turn); break;
      case 'task': this.hub.send('task', e.task); break;
      case 'pending': this.hub.send('pending', e.pending); break;
      case 'draft': this.hub.send('draft', e.text); break;
      case 'notice': this.hub.send('notice', { level: e.level, so: e.so, en: e.en }); break;
      case 'visitors-changed': this.hub.send('visitors-changed', null); break;
    }
  }

  private notice(level: 'info' | 'warn' | 'error', so: string, en: string) {
    this.hub.send('notice', { level, so, en });
  }

  private sendLevel(l: number) {
    const t = Date.now();
    if (t - this.lastLevelSent < 66) return;
    this.lastLevelSent = t;
    this.hub.send('micLevel', l);
  }

  devices(): DeviceStatus {
    const s = this.settings.get();
    return {
      micEnabled: s.audio.micEnabled,
      micCapturing: this.micCapturing,
      micPermission: this.micPermission,
      cameraEnabled: s.camera.enabled,
      cameraCapturing: this.camCapturing,
      cameraPermission: this.camPermission,
      speakerEnabled: s.audio.speakerEnabled,
    };
  }

  private pushDevices() {
    this.hub.send('devices', this.devices());
    this.hub.updateTray();
    this.updateAssistantPause();
  }

  private updateAssistantPause() {
    const s = this.settings.get();
    this.assistant?.setPaused(!s.audio.micEnabled && !s.camera.enabled && this.startedPausedAllowed());
  }
  private startedPausedAllowed() {
    return this.settings.get().setupComplete;
  }

  refreshPermissionStatus() {
    try {
      this.micPermission = systemPreferences.getMediaAccessStatus('microphone');
      this.camPermission = systemPreferences.getMediaAccessStatus('camera');
    } catch {
      /* not available on this platform */
    }
  }

  snapshot(): Snapshot {
    const s = this.settings.get();
    const o = this.memory.owner;
    return {
      version: app.getVersion(),
      settings: s,
      state: this.assistant?.state ?? 'sleeping',
      task: this.assistant?.currentTask() ?? null,
      pending: null,
      owner: { ...o, language: this.memory.doc.profile.language },
      devices: this.devices(),
      presence: this.presence.snapshot,
      assurance: this.assurance.level(),
      secretsPresent: this.secrets.names(),
      faceEnrolled: this.faces.enrolled,
      faceSamples: this.faces.ownerTemplates.length,
      voiceEnrolled: this.voice.enrolled,
      pendingVisitors: this.visitorLog.pending().length,
      mlCaps: this.ml.getCaps(),
      loadErrors: [...this.loadErrors, ...this.ml.getLoadErrors()],
      platform: process.platform,
      pinSet: this.secrets.has(SECRET.ownerPinHash),
    };
  }

  // ====================================================================== microphone

  async setMic(on: boolean): Promise<void> {
    const s = this.settings.get();
    if (on && !s.setupComplete) throw new Error('Finish the first-run setup before turning on listening.');
    this.settings.update({ audio: { micEnabled: on } });
    if (on) {
      this.lastMicErr = null;
      this.pipeline.setMicEnabled(true);
      await this.audio.start(s.audio.micDeviceId);
    } else {
      this.pipeline.setMicEnabled(false);
      await this.audio.stopCapture(); // device released immediately
      this.micCapturing = false;
      this.oneShot?.resolve(null);
    }
    this.pushDevices();
  }

  private onAudioStatus(st: MediaStatus) {
    this.micCapturing = st.capturing;
    if (st.error) {
      this.lastMicErr = st.error;
      const so = st.kind === 'blocked' ? 'Maykarafoonka waa la xiray: ka fur Windows Settings → Privacy → Microphone.' : st.kind === 'missing' ? 'Maykarafoon lama helin. Ku xir mid.' : st.kind === 'busy' ? 'Maykarafoonka barnaamij kale ayaa isticmaalaya.' : 'Maykarafoonka ma shaqeynayo.';
      this.notice('error', so, `Microphone problem: ${st.error}`);
      if (!st.capturing && this.settings.get().audio.micEnabled) this.settings.update({ audio: { micEnabled: false } });
      this.pipeline.setMicEnabled(false);
    }
    this.refreshPermissionStatus();
    this.pushDevices();
  }

  private onPipelineNotice(kind: 'no_speech' | 'too_long' | 'ml_error', detail?: string) {
    if (kind === 'ml_error') {
      this.log.warn('pipeline: ' + detail);
      this.notice('warn', 'Moodelka maxaliga ah ma diyaar aha (Settings → Setup).', `Local speech model problem: ${detail}`);
    }
  }

  // ====================================================================== utterances

  private onWake(rest: string | null) {
    this.log.info('wake word detected');
    this.hub.send('state', 'listening');
    if (rest === null) void this.assistant.onActivated();
    else this.greetBeforeNext = true;
  }

  private async onUtterance(pcm: Int16Array, ctx: { fromWake: boolean; duringSpeech: boolean }) {
    if (this.oneShot) {
      const o = this.oneShot;
      this.oneShot = null;
      clearTimeout(o.timer);
      o.resolve(pcm);
      return;
    }
    this.assistant.setListening(true);
    let text = '';
    try {
      const r = await this.sttRouter.transcribe(pcm, { prompt: BIAS_PROMPT });
      text = r.text.trim();
      this.log.info(`stt ${r.provider} ${r.latencyMs} ms${r.confidence !== null ? ' conf ' + r.confidence.toFixed(2) : ''} len ${text.length}`);
    } catch (e) {
      this.assistant.setListening(false);
      if ((e as Error).name === 'AbortError') return;
      const m = sttErrorMessage(e);
      this.notice('error', m.so, m.en);
      // speak the Somali explanation at most once a minute so repeated failures do not nag
      if (Date.now() - this.lastSttErrAt > 60_000) {
        this.lastSttErrAt = Date.now();
        if (this.settings.get().audio.speakerEnabled) void this.speech.speak(m.so, undefined, 'so').catch(() => undefined);
      }
      return;
    }
    this.assistant.setListening(false);
    if (!text) return;

    if (ctx.duringSpeech) {
      // barge-in: only act on something that is not our own voice
      if (this.echo.isEcho(text)) return;
      if (!this.settings.get().audio.bargeIn) return;
      this.speech.stop();
    }
    if (this.greetBeforeNext) {
      this.greetBeforeNext = false;
      await this.assistant.onActivated();
    }
    const speaker = await this.identifySpeaker(pcm);
    // wake word + command in one breath: the parser strips the leading wake word
    await this.assistant.handle(text, { source: 'voice', speaker });
  }

  private async identifySpeaker(pcm: Int16Array): Promise<SpeakerMatch> {
    const s = this.settings.get();
    if (!s.voiceId.enabled || !this.voice.enrolled || !this.ml.getCaps().speaker) return 'unknown';
    if (pcm.length < 16000 * 1.2) return 'unknown';
    try {
      const emb = await this.ml.embed(pcm);
      if (!emb) return 'unknown';
      const v = judgeVoice(emb, this.voice.templates, s.voiceId.threshold, s.voiceId.uncertainBand);
      this.log.info(`voice-id ${v.verdict} ${v.score.toFixed(2)}`);
      return v.verdict;
    } catch {
      return 'unknown';
    }
  }

  /** Capture the next utterance as raw audio (visitor replies, enrollment, calibration). */
  private captureNext(timeoutMs: number, signal?: AbortSignal): Promise<Int16Array | null> {
    return new Promise((resolve) => {
      if (!this.settings.get().audio.micEnabled && !this.micCapturing) return resolve(null);
      const timer = setTimeout(() => {
        this.oneShot = null;
        resolve(null);
      }, timeoutMs);
      this.oneShot = { resolve, timer };
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        this.oneShot = null;
        resolve(null);
      }, { once: true });
      this.pipeline.openCommandWindow();
    });
  }

  // ====================================================================== camera & presence

  async setCamera(on: boolean): Promise<void> {
    const s = this.settings.get();
    if (on) {
      if (!s.setupComplete) throw new Error('Finish the first-run setup before turning on the camera.');
      if (!this.faces.enrolled) throw new Error('Enroll your face first (Setup → Face).');
    }
    this.settings.update({ camera: { enabled: on } });
    if (on) {
      this.lastCamErr = null;
      await this.pushTemplates();
      await this.vision.start(s.camera.deviceId, s.camera.fps);
    } else {
      this.visitorCtl?.abort();
      await this.vision.stop(); // camera released: LED off
      this.camCapturing = false;
      this.presence.reset();
      this.assurance.reset();
    }
    this.pushDevices();
  }

  private async pushTemplates() {
    await this.vision.setTemplates(this.faces.ownerTemplates, this.faces.known.map((k) => ({ id: k.id, templates: k.templates })));
  }

  private onCameraStatus(st: MediaStatus) {
    this.camCapturing = st.capturing && !st.loading;
    if (st.error) {
      this.lastCamErr = st.error;
      const so = st.kind === 'blocked' ? 'Kamaradda waa la xiray: ka fur Windows Settings → Privacy → Camera.' : st.kind === 'missing' ? 'Kamarad lama helin.' : st.kind === 'busy' ? 'Kamaradda barnaamij kale ayaa isticmaalaya.' : 'Kamaradda ma shaqeynayo.';
      this.notice('error', so, `Camera problem: ${st.error}`);
      if (!st.capturing && this.settings.get().camera.enabled) this.settings.update({ camera: { enabled: false } });
    }
    this.refreshPermissionStatus();
    this.pushDevices();
  }

  private onFrame(frame: Parameters<PresenceTracker['push']>[0]) {
    const events = this.presence.push(frame);
    for (const ev of events) {
      switch (ev.type) {
        case 'owner_arrived':
          this.assurance.ownerFaceSeen();
          this.visitorCtl?.abort(); // the owner is back: stop questioning anyone
          this.visitorGate.reset();
          void this.assistant.onOwnerArrived();
          break;
        case 'owner_seen':
          this.assurance.ownerFaceSeen();
          break;
        case 'owner_left':
          this.assistant.onOwnerLeft();
          break;
        case 'unknown_arrived':
          this.assurance.unknownFaceSeen();
          void this.onUnknownArrived(ev.bestOwnerSimilarity);
          break;
        case 'uncertain':
          this.notice('info', 'Ma hubo in aad tahay adiga. Wajiga si fiican u fiiri kamaradda ama iftiinka hagaaji.', `Face match is uncertain (${ev.reason}). Face the camera or improve the lighting.`);
          break;
        case 'possible_photo':
          this.notice('warn', 'Waxay u egtahay sawir ama shaashad, ma aqbalayo.', 'The camera sees what looks like a photo or screen; it was not accepted as you.');
          break;
        case 'lighting':
          if (ev.state !== 'ok') this.notice('info', ev.state === 'dark' ? 'Iftiinku aad buu u yar yahay.' : 'Iftiinku aad buu u badan yahay.', ev.state === 'dark' ? 'The room is too dark for reliable recognition.' : 'The image is overexposed.');
          break;
      }
    }
    const t = Date.now();
    if (t - this.lastPresenceSent > 500) {
      this.lastPresenceSent = t;
      this.hub.send('presence', this.presence.snapshot);
    }
  }

  private async onUnknownArrived(bestOwnerSim: number | null) {
    const s = this.settings.get();
    if (!s.visitors.enabled || !s.camera.enabled) return;
    if (!this.visitorGate.canStart(s.visitors.cooldownMin)) return;
    this.visitorGate.started(s.visitors.cooldownMin);
    const ctl = new AbortController();
    this.visitorCtl = ctl;
    const canTalk = s.audio.speakerEnabled && (s.audio.micEnabled || this.micCapturing);
    try {
      if (!canTalk) {
        // observation only: nothing is asked, nothing is recorded beyond the fact itself
        this.visitorLog.add({ at: Date.now(), recognitionState: 'unknown', recognitionConfidence: bestOwnerSim, selfReportedName: null, selfReportedGender: null, transcript: null, consent: 'not_asked', noticeSpokenAt: null, disclosures: [], snapshotId: null, audioId: null });
        return;
      }
      const io: VisitorIO = {
        speak: async (text, signal) => {
          this.echo.noteSpeaking(text, 400 + text.length * 70);
          await this.speech.speak(text, signal, 'so').catch(() => undefined);
          this.echo.speechEnded();
        },
        listen: async (ms, signal) => {
          const pcm = await this.captureNext(ms, signal);
          if (!pcm) return null;
          const r = await this.sttRouter.transcribe(pcm, { signal }).catch(() => null);
          return r?.text ? { text: r.text, audio: this.settings.get().visitors.saveAudio ? pcmToWav(pcm) : undefined } : null;
        },
        snapshot: () => this.vision.snapshot(),
      };
      await runVisitorFlow(io, this.visitorLog, { owner: this.memory.owner, settings: s, recognitionConfidence: bestOwnerSim, recognitionState: 'unknown' }, ctl.signal);
    } catch (e) {
      this.log.error('visitor flow', e);
    } finally {
      if (this.visitorCtl === ctl) this.visitorCtl = null;
      this.pipeline.refresh();
    }
  }

  // ====================================================================== enrollment

  async faceEnrollStart(label?: string): Promise<void> {
    this.enrollLabel = label?.trim() || null;
    this.faceEnroll = new FaceEnrollment(10, 2, true);
    this.enrollTempCamera = !this.camCapturing;
    await this.vision.setTemplates([], []);
    await this.vision.start(this.settings.get().camera.deviceId, 4);
    await this.vision.setEnroll(true);
    this.sendEnroll({ kind: 'face', progress: this.faceEnroll.progress() });
  }

  private onEnrollSamples(m: { samples: any[]; luminance: number; faceVisible: boolean }) {
    const e = this.faceEnroll;
    if (!e) return;
    if (m.samples.length === 0) return this.sendEnroll({ kind: 'face', progress: e.progress(), luminance: m.luminance, faceVisible: false });
    if (m.samples.length > 1) return this.sendEnroll({ kind: 'face', progress: e.progress(), luminance: m.luminance, faceVisible: true, lastRejected: { so: 'Hal qof oo kaliya kamaradda ha ku jiro.', en: 'Only one person should be in view.' } });
    const r = e.add(m.samples[0]);
    this.sendEnroll({ kind: 'face', progress: r.progress, luminance: m.luminance, faceVisible: true, lastRejected: r.accepted ? undefined : { so: r.so, en: r.en } });
  }

  private sendEnroll(u: EnrollUpdate) {
    this.hub.send('enroll', u);
  }

  async faceEnrollFinish(): Promise<{ matchThreshold: number; unknownCeiling: number }> {
    if (!this.faceEnroll) throw new Error('no enrollment in progress');
    const r = this.faceEnroll.finish();
    if (this.enrollLabel) {
      // a separate enrollment of ANOTHER person (e.g. a visitor the owner chose to mark as known); thresholds are untouched
      this.faces.addKnown(this.enrollLabel, r.templates);
    } else {
      this.faces.setOwner(r.templates, r.lightingBuckets);
      this.settings.update({ camera: { matchThreshold: r.suggested.matchThreshold, unknownCeiling: r.suggested.unknownCeiling } });
    }
    await this.faces.flush();
    await this.faceEnrollCancel();
    this.hub.send('snapshot', this.snapshot());
    return r.suggested;
  }

  async faceEnrollCancel(): Promise<void> {
    this.faceEnroll = null;
    this.enrollLabel = null;
    await this.vision.setEnroll(false);
    if (this.enrollTempCamera && !this.settings.get().camera.enabled) await this.vision.stop();
    else if (this.settings.get().camera.enabled) await this.pushTemplates();
    this.enrollTempCamera = false;
  }

  async faceDelete(): Promise<void> {
    await this.setCamera(false).catch(() => undefined);
    await this.faces.deleteAll();
    this.hub.send('snapshot', this.snapshot());
  }

  async voiceEnrollStart(): Promise<void> {
    if (!this.ml.getCaps().speaker) throw new Error('Install the speaker model first (Setup → Models).');
    if (!this.ml.getCaps().vad) throw new Error('Install the voice-activity model first (Setup → Models).');
    this.voiceEnroll = new VoiceEnrollment(6, 1.5);
    const wasOn = this.micCapturing;
    if (!wasOn) {
      this.pipeline.setMicEnabled(true);
      await this.audio.start(this.settings.get().audio.micDeviceId);
    }
    const prompts = ['Magacaygu waa Hassan Mohamed Mohamud.', 'Afuufow, Chrome fur.', 'Downloads-ka fur oo ii raadi file-ka invoice-ka.', 'Ii shid heesta aan jeclahay.', 'Codka hoos u dhig, kadibna jooji muuqaalka.', 'Fariiso, shaqo ii dir.'];
    void (async () => {
      let i = 0;
      while (this.voiceEnroll && !this.voiceEnroll.complete && i < 24) {
        this.hub.send('enroll', { kind: 'voice', progress: { total: this.voiceEnroll.count, target: 6, hintSo: `Dheh: “${prompts[this.voiceEnroll.count % prompts.length]}”`, hintEn: `Say: “${prompts[this.voiceEnroll.count % prompts.length]}”`, complete: false } });
        const pcm = await this.captureNext(20_000);
        if (!this.voiceEnroll) break;
        i++;
        if (!pcm) continue;
        const emb = await this.ml.embed(pcm).catch(() => null);
        if (!emb) continue;
        const r = this.voiceEnroll.add(emb, pcm.length / 16000);
        this.hub.send('enroll', { kind: 'voice', progress: { total: r.count, target: 6, hintSo: r.so, hintEn: r.en, complete: this.voiceEnroll.complete }, lastRejected: r.accepted ? undefined : { so: r.so, en: r.en } });
      }
      if (!wasOn && !this.settings.get().audio.micEnabled) {
        this.pipeline.setMicEnabled(false);
        await this.audio.stopCapture();
      }
    })();
  }

  voiceEnrollCancel() {
    this.voiceEnroll = null;
    this.oneShot?.resolve(null);
  }

  async voiceEnrollFinish(): Promise<void> {
    if (!this.voiceEnroll?.complete) throw new Error('voice enrollment is not complete');
    const r = this.voiceEnroll.finish();
    this.voice.set(r.templates, 'wespeaker_en_voxceleb_resnet34');
    await this.voice.flush();
    this.settings.update({ voiceId: { enabled: true, threshold: r.suggestedThreshold } });
    this.voiceEnroll = null;
    this.hub.send('snapshot', this.snapshot());
  }

  async voiceDelete() {
    await this.voice.deleteAll();
    this.settings.update({ voiceId: { enabled: false } });
    this.hub.send('snapshot', this.snapshot());
  }

  /** Say "Afuufow" three times; whatever the recogniser heard becomes an accepted spelling. */
  async calibrateWake(): Promise<string[]> {
    const heard: string[] = [];
    const wasOn = this.micCapturing;
    if (!wasOn) {
      this.pipeline.setMicEnabled(true);
      await this.audio.start(this.settings.get().audio.micDeviceId);
    }
    try {
      for (let i = 0; i < 3; i++) {
        this.notice('info', `Dheh “Afuufow” (${i + 1}/3)`, `Say “Afuufow” (${i + 1}/3)`);
        const pcm = await this.captureNext(15_000);
        if (!pcm) continue;
        let t = '';
        try {
          t = this.ml.hasLocalAsr() ? await this.ml.transcribeLocal(pcm, 'en') : (await this.sttRouter.transcribe(pcm, { prompt: 'Afuufow' })).text;
        } catch {
          /* skip */
        }
        t = t.replace(/[^\p{L}\s]/gu, '').trim().toLowerCase();
        if (t && t.split(' ').length <= 3) heard.push(t);
      }
    } finally {
      if (!wasOn && !this.settings.get().audio.micEnabled) {
        this.pipeline.setMicEnabled(false);
        await this.audio.stopCapture();
      }
    }
    const s = this.settings.get();
    const aliases = [...new Set([...s.audio.wakeAliases, ...heard])].slice(0, 12);
    this.settings.update({ audio: { wakeAliases: aliases } });
    return heard;
  }

  // ====================================================================== authentication

  setPin(pin: string) {
    if (!validPinFormat(pin)) throw new Error('PIN must be 4-12 digits');
    this.secrets.set(SECRET.ownerPinHash, hashPin(pin));
  }

  verifyPin(pin: string): boolean {
    const locked = this.pinLimiter.lockedFor();
    if (locked > 0) throw new Error(`Too many wrong attempts. Try again in ${Math.ceil(locked / 1000)} s.`);
    const stored = this.secrets.get(SECRET.ownerPinHash);
    if (!stored) throw new Error('No PIN is set');
    const ok = verifyPinHash(pin, stored);
    if (ok) {
      this.pinLimiter.success();
      this.assurance.strongVerified();
      this.authWaiter?.(true);
      this.authWaiter = null;
      this.hub.send('authRequest', null);
    } else this.pinLimiter.fail();
    return ok;
  }

  cancelAuth() {
    this.authWaiter?.(false);
    this.authWaiter = null;
    this.hub.send('authRequest', null);
  }

  async helloVerify(): Promise<{ available: boolean; result: string }> {
    const r = await runJson<{ available: boolean; result: string }>(runPowerShell, withParams(SCRIPTS.helloVerify, { message: 'Afuufow' }), { timeoutMs: 70_000 });
    if (r?.available && r.result === 'Verified') {
      this.assurance.strongVerified();
      this.authWaiter?.(true);
      this.authWaiter = null;
      this.hub.send('authRequest', null);
    }
    return r ?? { available: false, result: 'no result' };
  }

  private requestStrongAuth(reason: string): Promise<boolean> {
    const method = this.settings.get().permissions.strongAuth.method;
    const pinSet = this.secrets.has(SECRET.ownerPinHash);
    if (method === 'pin' && !pinSet) {
      this.notice('warn', 'Marka hore dejiso PIN (Settings → Ogolaansho).', 'Set an owner PIN first (Settings → Permissions).');
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      this.authWaiter?.(false);
      const timer = setTimeout(() => {
        this.authWaiter = null;
        this.hub.send('authRequest', null);
        resolve(false);
      }, 90_000);
      this.authWaiter = (ok) => {
        clearTimeout(timer);
        resolve(ok);
      };
      this.hub.send('authRequest', { reason, allowHello: method !== 'pin', pinSet });
      this.hub.showMainWindow();
    });
  }

  private async awaitPresence(timeoutMs: number, signal: AbortSignal): Promise<boolean> {
    if (!this.settings.get().camera.enabled || !this.camCapturing) {
      this.notice('warn', 'Kamaradda waa dansan tahay; ma xaqiijin karo. Fur kamaradda ama isticmaal PIN.', 'The camera is off, so I cannot confirm it is you. Turn it on or use your PIN.');
      return false;
    }
    const end = Date.now() + timeoutMs;
    while (Date.now() < end && !signal.aborted) {
      if (this.assurance.atLeast('presence')) return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return this.assurance.atLeast('presence');
  }

  // ====================================================================== commands from UI

  async submitText(text: string) {
    await this.assistant.handle(text, { source: 'text' });
  }

  answer(a: { yes?: boolean; choice?: number; text?: string }) {
    const t = a.text ?? (a.yes === true ? 'haa' : a.yes === false ? 'maya' : a.choice !== undefined ? String(a.choice + 1) : '');
    if (t) void this.assistant.handle(t, { source: 'text' });
  }

  pttToggle() {
    if (!this.settings.get().audio.micEnabled) {
      this.notice('warn', 'Maykarafoonka waa dansan yahay.', 'The microphone is off. Turn it on first.');
      return;
    }
    if (!this.pttActive) {
      this.pttActive = this.pipeline.beginPushToTalk();
      this.hub.send('state', 'listening');
      setTimeout(() => {
        if (this.pttActive) this.pttToggle();
      }, 30_000).unref?.();
    } else {
      this.pttActive = false;
      this.pipeline.endPushToTalk();
    }
  }

  stopEverything() {
    this.assistant.stopAll('shortcut');
    this.visitorCtl?.abort();
  }

  // ====================================================================== windows session events

  private registerPowerEvents() {
    const add = (kind: 'lock' | 'unlock' | 'suspend' | 'resume') => this.visitorLog.addSession({ at: Date.now(), kind, source: 'power-monitor' });
    powerMonitor.on('lock-screen', () => add('lock'));
    powerMonitor.on('unlock-screen', () => add('unlock'));
    powerMonitor.on('suspend', () => {
      add('suspend');
      void this.audio.stopCapture();
      void this.vision.stop();
    });
    powerMonitor.on('resume', () => {
      add('resume');
      const s = this.settings.get();
      if (s.audio.micEnabled) void this.audio.start(s.audio.micDeviceId);
      if (s.camera.enabled) void this.vision.start(s.camera.deviceId, s.camera.fps);
    });
  }

  /** Best effort: the Security log needs elevated rights, so this is usually "unavailable" for a normal user. Camera events and Windows events stay separate either way. */
  private async scanSecurityLog() {
    if (process.platform !== 'win32') return;
    try {
      const r = await runJson<{ available: boolean; reason?: string; events: Array<{ id: number; at: number }> }>(runPowerShell, withParams(SCRIPTS.securityLogEvents, { sinceMs: 48 * 3600_000 }), { timeoutMs: 25_000 });
      if (!r?.available) {
        this.log.info('Windows Security log not readable (needs elevated rights): ' + (r?.reason ?? ''));
        return;
      }
      const existing = this.visitorLog.sessionEvents();
      for (const e of r.events ?? []) {
        const kind = e.id === 4801 ? 'unlock' : e.id === 4800 ? 'lock' : 'logon_event';
        if (existing.some((x) => Math.abs(x.at - e.at) < 5000 && (x.kind === kind || x.source === 'event-log'))) continue;
        this.visitorLog.addSession({ at: e.at, kind, source: 'event-log', detail: `Event ${e.id}` });
      }
    } catch (e) {
      this.log.warn('security log scan failed: ' + (e as Error).message);
    }
  }

  // ====================================================================== models

  async downloadModel(id: string) {
    const last = this.downloads.get(id) ?? 0;
    void last;
    this.downloads.set(id, 0);
    try {
      await this.models.download(id, (received, total) => {
        const now = Date.now();
        if (now - (this.downloads.get(id) ?? 0) > 250) {
          this.downloads.set(id, now);
          this.hub.send('download', { id, received, total, done: false });
        }
      });
      this.hub.send('download', { id, received: 1, total: 1, done: true });
      await this.ml.init();
      this.hub.send('snapshot', this.snapshot());
    } catch (e) {
      this.hub.send('download', { id, received: 0, total: 1, done: true, error: (e as Error).message });
      throw e;
    } finally {
      this.downloads.delete(id);
    }
  }

  async removeModel(id: string) {
    this.models.remove(id);
    await this.ml.init();
    this.hub.send('snapshot', this.snapshot());
  }

  // ====================================================================== diagnostics

  async diagnostics(): Promise<DiagnosticItem[]> {
    const s = this.settings.get();
    const out: DiagnosticItem[] = [];
    const add = (id: string, title: string, ok: boolean | null, detail: string, fixSo: string, fixEn: string) => out.push({ id, title, ok, detail, fixSo, fixEn });

    add('platform', 'Windows', process.platform === 'win32', `${os.platform()} ${os.release()} (${os.arch()})`, 'Afuufow waxay u dhisan tahay Windows 10/11.', 'Afuufow is built for Windows 10/11.');
    add('dpapi', 'Data protection (DPAPI)', DpapiAvailable(), 'Encrypts your memory, faces and keys for this Windows user.', 'Ka soo gal Windows akoon caadi ah.', 'Sign in with a normal Windows account.');
    try {
      const v = await runPowerShell('$PSVersionTable.PSVersion.ToString()', { timeoutMs: 15_000 });
      add('powershell', 'PowerShell', true, 'Windows PowerShell ' + v.trim(), '', '');
    } catch (e) {
      add('powershell', 'PowerShell', false, (e as Error).message, 'Hubi in powershell.exe la heli karo (PATH).', 'Make sure powershell.exe is available (PATH).');
    }
    this.refreshPermissionStatus();
    const devs = await this.audio.devices().catch(() => []);
    const mics = devs.filter((d) => d.kind === 'audioinput');
    add('mic', 'Microphone', mics.length > 0, mics.length ? `${mics.length} device(s): ${mics.map((m) => m.label || 'unnamed').join(', ')}` : 'No microphone found', 'Ku xir maykarafoon oo hubi Windows Settings → Privacy → Microphone.', 'Plug in a microphone and check Windows Settings → Privacy → Microphone.');
    add('micperm', 'Microphone permission', this.micPermission === 'granted' || this.micPermission === 'unknown' ? true : false, this.micPermission, 'Windows Settings → Privacy → Microphone → u ogolow barnaamijyada desktop-ka.', 'Windows Settings → Privacy → Microphone → allow desktop apps.');
    const cams = await this.vision.devices().catch(() => []);
    add('camera', 'Camera', cams.length > 0, cams.length ? `${cams.length} camera(s)` : 'No camera found', 'Ku xir kamarad oo hubi Privacy → Camera.', 'Connect a camera and check Privacy → Camera.');
    add('camperm', 'Camera permission', this.camPermission === 'granted' || this.camPermission === 'unknown' ? true : false, this.camPermission, 'Windows Settings → Privacy → Camera.', 'Windows Settings → Privacy → Camera.');
    const key = this.secrets.has(SECRET.azureSpeechKey);
    if (s.providers.stt.primary === 'azure' || s.providers.tts.primary === 'azure') {
      add('azurekey', 'Azure Speech key', key, key ? 'stored in Windows data protection' : 'not set', 'Gali furaha Azure Speech (Settings → Isku-xirka).', 'Enter your Azure Speech key (Settings → Integrations).');
      add('cloud', 'Cloud speech allowed', s.privacy.allowCloudStt && s.privacy.allowCloudTts, `STT ${s.privacy.allowCloudStt ? 'on' : 'off'}, TTS ${s.privacy.allowCloudTts ? 'on' : 'off'}`, 'Ku oggolow cloud-ka Settings → Qarsoodi.', 'Allow cloud speech under Settings → Privacy (audio is sent to Microsoft).');
    }
    const llm = await this.llm.ping().catch((e) => ({ ok: false, detail: (e as Error).message }));
    add('llm', `AI model (${s.providers.llm.primary})`, llm.ok, llm.detail, 'Rakib Ollama (ollama.com) oo orod: ollama pull ' + s.providers.llm.ollamaModel, 'Install Ollama (ollama.com) and run: ollama pull ' + s.providers.llm.ollamaModel);
    for (const m of this.models.status()) {
      if (['vad', 'kws'].includes(m.id)) add('model-' + m.id, m.title, m.installed, m.installed ? 'installed' : 'not installed', 'Setup → Moodellada → Soo deji.', 'Setup → Models → Download.');
    }
    add('mlcaps', 'On-device ML', this.ml.getCaps().vad, JSON.stringify(this.ml.getCaps()) + (this.ml.getLoadErrors().length ? ' errors: ' + this.ml.getLoadErrors().join('; ') : ''), 'Soo deji moodellada Setup-ka.', 'Download the models in Setup.');
    add('startup', 'Starts with Windows', app.getLoginItemSettings({ args: ['--background'] }).openAtLogin, app.getLoginItemSettings({ args: ['--background'] }).openAtLogin ? 'enabled' : 'disabled', 'Fur “Bilow Windows-ka”.', 'Turn on “Start with Windows”.');
    try {
      const r = await fetch('https://www.microsoft.com', { method: 'HEAD', signal: AbortSignal.timeout(6000) });
      add('internet', 'Internet', r.ok, `HTTP ${r.status}`, 'Hubi isku-xirka internetka.', 'Check your internet connection.');
    } catch (e) {
      add('internet', 'Internet', false, (e as Error).message, 'Hubi isku-xirka internetka. Amarrada maxaliga ah way shaqeynayaan.', 'Check your internet connection. Local commands still work.');
    }
    if (s.integrations.whatsapp.enabled) {
      const st = await this.services.whatsapp.status().catch(() => 'unavailable' as const);
      add('whatsapp', 'WhatsApp', st === 'ready', st, st === 'qr_required' ? 'Fur WhatsApp oo scan garee QR-ka.' : 'Hubi WhatsApp.', st === 'qr_required' ? 'Open WhatsApp and scan the QR code.' : 'Check WhatsApp.');
    }
    if (this.loadErrors.length) add('load', 'Data files', false, this.loadErrors.join('; '), 'Faylasha xogta waa la dhimay; kayd-ka ayaa la isticmaalay.', 'Some data files were damaged; backups were used where possible.');
    return out;
  }

  async testProvider(kind: 'stt' | 'tts' | 'llm' | 'whatsapp' | 'youtube' | 'speak'): Promise<{ ok: boolean; detail: string }> {
    const s = this.settings.get();
    const get = (n: string) => this.secrets.get(n);
    try {
      if (kind === 'stt') {
        const p = s.providers.stt.primary;
        if (p !== 'local' && !s.privacy.allowCloudStt && p !== 'openai') return { ok: false, detail: 'Cloud speech recognition is disabled in Privacy settings.' };
        const prov = p === 'azure' ? new AzureSttProvider(s.providers.stt.azureRegion, () => get(SECRET.azureSpeechKey), s.providers.stt.azureLanguage) : p === 'openai' ? new OpenAISttProvider(s.providers.stt.openaiBaseUrl, s.providers.stt.openaiModel, () => get(SECRET.openaiKey)) : new LocalSttProvider(this.ml);
        if (prov.isCloud && !s.privacy.allowCloudStt) return { ok: false, detail: 'Cloud speech recognition is disabled in Privacy settings.' };
        return await prov.check();
      }
      if (kind === 'tts') {
        if (s.providers.tts.primary === 'azure' && !s.privacy.allowCloudTts) return { ok: false, detail: 'Cloud speech synthesis is disabled in Privacy settings.' };
        const prov = s.providers.tts.primary === 'azure' ? new AzureTtsProvider(s.providers.tts.azureRegion, s.providers.tts.azureVoice, () => get(SECRET.azureSpeechKey), () => 1) : new SapiTtsProvider(runPowerShell, () => s.providers.tts.sapiVoiceHint);
        return await prov.check();
      }
      if (kind === 'speak') {
        await this.speech.speak(`Mudane ${this.memory.owner.greetingName}, tijaabo codka. Waan ku maqlayaa?`, undefined, 'so');
        return { ok: true, detail: 'Played a test sentence. If you heard it, speech output works.' };
      }
      if (kind === 'llm') return await this.llm.ping();
      if (kind === 'whatsapp') {
        const st = await this.services.whatsapp.status();
        return { ok: st === 'ready', detail: st };
      }
      if (kind === 'youtube') {
        const r = await this.services.youtube.search('Believer Imagine Dragons', 'song');
        return { ok: r.length > 0, detail: r.length ? `Search works (${r.length} results, best: ${r[0]!.title})` : 'No results' };
      }
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
    return { ok: false, detail: 'unknown test' };
  }

  // ====================================================================== data lifecycle

  async deleteEverything() {
    await this.setMic(false).catch(() => undefined);
    await this.setCamera(false).catch(() => undefined);
    await this.memory.wipeAll();
    this.visitorLog.deleteAll();
    await this.faces.deleteAll();
    await this.voice.deleteAll();
    this.actionLog.clear();
    this.grants.revokeAll();
    for (const n of this.secrets.names()) this.secrets.delete(n);
    await this.pageDriver.clearSession().catch(() => undefined);
    await this.flushAll();
    fs.rmSync(this.dataDir, { recursive: true, force: true });
    app.relaunch();
    app.exit(0);
  }

  async flushAll() {
    await Promise.allSettled([this.memory.flush(), this.visitorLog.flush(), this.actionLog.flush(), this.grants.flush(), this.faces.flush(), this.voice.flush()]);
  }

  async shutdown() {
    for (const t of this.timers) clearInterval(t);
    this.speech?.stop();
    await this.flushAll();
    this.ml.stop();
    this.audio.destroy();
    this.vision.destroy();
  }
}

function DpapiAvailable(): boolean {
  try {
    return safeStorageCipher.available();
  } catch {
    return false;
  }
}

function keysOf(rt: Runtime) {
  return new DpapiKeyProvider(path.join(rt['userData'], 'data'));
}

export { uid, floatToInt16, parseCommand, MODELS };
