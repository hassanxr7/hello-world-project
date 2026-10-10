import { z } from 'zod';
import { deepMerge } from '../util';

const Retention = z.object({
  historyDays: z.number().int().min(0).max(3650), // 0 = do not keep
  actionLogDays: z.number().int().min(0).max(3650),
  visitorDays: z.number().int().min(0).max(3650),
  snapshotDays: z.number().int().min(0).max(3650),
});

export const DEFAULT_WELCOME_MESSAGE =
  'Mudane {name}, si fiican ayaan kuu arkaa, kuna maqlayaa. Waxaan ahay Afuufow, qofka kula hadlaya, maamulaha shirkaddaada. ' +
  'Soo dhawoow, Mudane. Shaqo ayaan kaa sugayaa; i amar. Waxaan ahay Afuufow, ii tilmaam halka aan afuufi lahaa.';

export const SettingsSchema = z.object({
  version: z.literal(1),
  setupComplete: z.boolean(),
  general: z.object({
    theme: z.enum(['dark', 'light', 'system']),
    uiLanguage: z.enum(['so', 'en']),
    /** Language the assistant speaks. Somali by default unless the owner asks otherwise. */
    speechLanguage: z.enum(['so', 'en']),
    /** Spoken when the owner arrives or activates Afuufow. {name}=greeting name, {nickname}=nickname. Empty = the short default greeting. */
    welcomeMessage: z.string().max(1000),
    startWithWindows: z.boolean(),
    startHidden: z.boolean(),
    pushToTalkShortcut: z.string(),
    stopShortcut: z.string(),
    showWindowShortcut: z.string(),
  }),
  audio: z.object({
    micEnabled: z.boolean(),
    speakerEnabled: z.boolean(),
    micDeviceId: z.string().nullable(),
    speakerDeviceId: z.string().nullable(),
    wakeWordEnabled: z.boolean(),
    wakeWord: z.string(),
    /** Extra spellings/misrecognitions of the wake word learned during calibration. */
    wakeAliases: z.array(z.string()),
    /** How the wake word is detected. 'local' = on-device Whisper on short speech segments. */
    wakeEngine: z.enum(['local', 'cloud']),
    vadThreshold: z.number().min(0.1).max(0.95),
    commandWindowSec: z.number().min(3).max(30),
    bargeIn: z.boolean(),
    ttsVolume: z.number().min(0).max(1),
  }),
  providers: z.object({
    stt: z.object({
      primary: z.enum(['azure', 'openai', 'local']),
      fallback: z.enum(['none', 'azure', 'openai', 'local']),
      azureRegion: z.string(),
      azureLanguage: z.string(),
      openaiBaseUrl: z.string(),
      openaiModel: z.string(),
      localModel: z.enum(['whisper-tiny', 'whisper-base', 'whisper-small', 'whisper-medium']),
    }),
    tts: z.object({
      primary: z.enum(['azure', 'sapi']),
      fallback: z.enum(['none', 'sapi']),
      azureRegion: z.string(),
      azureVoice: z.string(),
      sapiVoiceHint: z.string(),
      rate: z.number().min(0.5).max(2),
    }),
    llm: z.object({
      primary: z.enum(['ollama', 'openai', 'anthropic']),
      ollamaBaseUrl: z.string(),
      ollamaModel: z.string(),
      openaiBaseUrl: z.string(),
      openaiModel: z.string(),
      anthropicModel: z.string(),
      temperature: z.number().min(0).max(2),
    }),
  }),
  privacy: z.object({
    allowCloudStt: z.boolean(),
    allowCloudTts: z.boolean(),
    allowCloudLlm: z.boolean(),
    allowScreenContentToCloud: z.boolean(),
    retention: Retention,
  }),
  camera: z.object({
    enabled: z.boolean(),
    deviceId: z.string().nullable(),
    /** Frames per second processed while monitoring. */
    fps: z.number().min(0.5).max(10),
    /** similarity >= this => owner. */
    matchThreshold: z.number().min(0.3).max(0.95),
    /** similarity <= this => definitely not owner. In between => "uncertain". */
    unknownCeiling: z.number().min(0.1).max(0.9),
    requireLiveness: z.boolean(),
    stableFrames: z.number().int().min(1).max(30),
    greetingCooldownMin: z.number().min(1).max(1440),
    leaveAfterSec: z.number().min(5).max(3600),
    presenceTtlSec: z.number().min(10).max(3600),
  }),
  voiceId: z.object({
    enabled: z.boolean(),
    threshold: z.number().min(0.2).max(0.95),
    uncertainBand: z.number().min(0).max(0.3),
  }),
  visitors: z.object({
    enabled: z.boolean(),
    snapshot: z.enum(['off', 'disclosed']),
    saveAudio: z.boolean(),
    cooldownMin: z.number().min(1).max(1440),
    responseWindowSec: z.number().min(5).max(60),
  }),
  permissions: z.object({
    appPolicy: z.enum(['any', 'allowlist']),
    approvedApps: z.array(z.string()),
    approvedFolders: z.array(z.object({ label: z.string(), path: z.string() })),
    messaging: z.object({
      /** 'explicit' = only a clear send verb sends. 'fast' = approved fast-send contacts may send on "u qor" too. */
      mode: z.enum(['explicit', 'fast']),
      requirePresenceToSend: z.boolean(),
    }),
    strongAuth: z.object({
      method: z.enum(['hello', 'pin', 'either']),
      ttlSec: z.number().min(30).max(1800),
    }),
    activationGreetingCooldownMin: z.number().min(0).max(1440),
  }),
  integrations: z.object({
    searchEngine: z.enum(['google', 'bing', 'duckduckgo']),
    browser: z.enum(['default', 'chrome', 'edge', 'firefox']),
    youtube: z.object({ playIn: z.enum(['app', 'browser']), useApi: z.boolean() }),
    whatsapp: z.object({ enabled: z.boolean(), mode: z.enum(['web', 'desktop']) }),
  }),
});

export type Settings = z.infer<typeof SettingsSchema>;

export function defaultSettings(): Settings {
  return {
    version: 1,
    setupComplete: false,
    general: {
      theme: 'dark',
      uiLanguage: 'so',
      speechLanguage: 'so',
      welcomeMessage: DEFAULT_WELCOME_MESSAGE,
      startWithWindows: false,
      startHidden: true,
      pushToTalkShortcut: 'Control+Alt+Space',
      stopShortcut: 'Control+Alt+Escape',
      showWindowShortcut: 'Control+Alt+A',
    },
    audio: {
      micEnabled: false,
      speakerEnabled: true,
      micDeviceId: null,
      speakerDeviceId: null,
      wakeWordEnabled: false,
      wakeWord: 'Afuufow',
      wakeAliases: [],
      wakeEngine: 'local',
      vadThreshold: 0.5,
      commandWindowSec: 10,
      bargeIn: true,
      ttsVolume: 1,
    },
    providers: {
      stt: {
        primary: 'azure',
        fallback: 'local',
        azureRegion: 'eastus',
        azureLanguage: 'so-SO',
        openaiBaseUrl: 'https://api.openai.com/v1',
        openaiModel: 'gpt-4o-transcribe',
        localModel: 'whisper-small',
      },
      tts: {
        primary: 'azure',
        fallback: 'sapi',
        azureRegion: 'eastus',
        azureVoice: 'so-SO-MuuseNeural',
        sapiVoiceHint: 'David',
        rate: 1,
      },
      llm: {
        primary: 'ollama',
        ollamaBaseUrl: 'http://127.0.0.1:11434',
        ollamaModel: 'gemma3:4b',
        openaiBaseUrl: 'https://api.openai.com/v1',
        openaiModel: 'gpt-4.1-mini',
        anthropicModel: 'claude-sonnet-5-5',
        temperature: 0.4,
      },
    },
    privacy: {
      allowCloudStt: false,
      allowCloudTts: false,
      allowCloudLlm: false,
      allowScreenContentToCloud: false,
      retention: { historyDays: 30, actionLogDays: 90, visitorDays: 180, snapshotDays: 30 },
    },
    camera: {
      enabled: false,
      deviceId: null,
      fps: 2,
      matchThreshold: 0.62,
      unknownCeiling: 0.45,
      requireLiveness: true,
      stableFrames: 4,
      greetingCooldownMin: 30,
      leaveAfterSec: 90,
      presenceTtlSec: 120,
    },
    voiceId: { enabled: false, threshold: 0.6, uncertainBand: 0.1 },
    visitors: { enabled: false, snapshot: 'off', saveAudio: false, cooldownMin: 30, responseWindowSec: 20 },
    permissions: {
      appPolicy: 'any',
      approvedApps: [],
      approvedFolders: [],
      messaging: { mode: 'explicit', requirePresenceToSend: true },
      strongAuth: { method: 'pin', ttlSec: 300 },
      activationGreetingCooldownMin: 10,
    },
    integrations: {
      searchEngine: 'google',
      browser: 'default',
      youtube: { playIn: 'app', useApi: false },
      whatsapp: { enabled: false, mode: 'web' },
    },
  };
}

/** Merge stored settings over defaults and validate. Returns defaults + error text if invalid. */
export function loadSettings(stored: unknown): { settings: Settings; error?: string } {
  const merged = deepMerge(defaultSettings(), stored);
  const r = SettingsSchema.safeParse(merged);
  if (r.success) return { settings: r.data };
  return { settings: defaultSettings(), error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
}
