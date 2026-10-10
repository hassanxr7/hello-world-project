import type { Settings } from '../core/config/settings';
import type { PendingInfo, TaskInfo } from '../core/assistant/types';
import type { ActionRecord, AssistantState, ChatTurn, Contact, PermissionGrant } from './types';
import type { OwnerNames } from './phrases';
import type { PresenceSnapshot } from '../core/vision/presence';
import type { MemoryFact } from '../core/memory/memory';
import type { SessionEvent, VisitorEvent } from '../core/visitors/log';

export interface DeviceStatus {
  micEnabled: boolean;
  micCapturing: boolean;
  micPermission: string; // granted | denied | not-determined | unknown
  cameraEnabled: boolean;
  cameraCapturing: boolean;
  cameraPermission: string;
  speakerEnabled: boolean;
}

export interface ModelStatus {
  id: string;
  title: string;
  sizeMb: number;
  installed: boolean;
  purpose: string;
  /** which feature needs it */
  needed: string;
}

export interface DiagnosticItem {
  id: string;
  title: string;
  ok: boolean | null; // null = not applicable / not configured
  detail: string;
  fixSo: string;
  fixEn: string;
}

export interface Snapshot {
  version: string;
  settings: Settings;
  state: AssistantState;
  task: TaskInfo | null;
  pending: PendingInfo | null;
  owner: OwnerNames & { language: 'so' | 'en' };
  devices: DeviceStatus;
  presence: PresenceSnapshot;
  assurance: 'none' | 'voice' | 'presence' | 'strong';
  secretsPresent: string[];
  faceEnrolled: boolean;
  faceSamples: number;
  voiceEnrolled: boolean;
  pendingVisitors: number;
  mlCaps: { vad: boolean; asr: string | null; kws: boolean; speaker: boolean };
  loadErrors: string[];
  platform: string;
  pinSet: boolean;
}

export interface EnrollUpdate {
  kind: 'face' | 'voice';
  progress: { total: number; target: number; hintSo: string; hintEn: string; complete: boolean; lighting?: Record<string, number>; pose?: Record<string, number> };
  lastRejected?: { so: string; en: string };
  luminance?: number;
  faceVisible?: boolean;
}

/** Request/response API (renderer -> main). */
export interface IpcMethods {
  'app.snapshot': () => Snapshot;
  'app.quit': () => void;
  'app.openLogs': () => void;
  'app.setLoginItem': (on: boolean) => void;
  'app.completeSetup': (o: { approveDefaultFolders: boolean }) => void;
  'cmd.text': (text: string) => void;
  'cmd.stop': () => void;
  'cmd.cancelTask': () => void;
  'cmd.answer': (a: { yes?: boolean; choice?: number; text?: string }) => void;
  'cmd.pttToggle': () => void;
  'mic.set': (on: boolean) => void;
  'cam.set': (on: boolean) => void;
  'speaker.set': (on: boolean) => void;
  'settings.update': (patch: Record<string, unknown>) => Settings;
  'secret.set': (a: { name: string; value: string }) => void;
  'secret.delete': (name: string) => void;
  'profile.set': (p: Partial<OwnerNames> & { language?: 'so' | 'en' }) => void;
  'memory.get': () => { facts: MemoryFact[]; preferences: Record<string, string>; favorites: { apps: string[]; folders: Array<{ label: string; path: string }> } };
  'memory.addFact': (text: string) => void;
  'memory.correctFact': (a: { id: string; text: string }) => void;
  'memory.deleteFact': (id: string) => void;
  'memory.export': () => string;
  'memory.wipe': () => void;
  'history.get': (limit?: number) => ChatTurn[];
  'history.clear': () => void;
  'actions.get': () => ActionRecord[];
  'actions.clear': () => void;
  'actions.export': () => string;
  'contacts.list': () => Contact[];
  'contacts.upsert': (c: Omit<Contact, 'id'> & { id?: string }) => Contact;
  'contacts.delete': (id: string) => void;
  'grants.list': () => PermissionGrant[];
  'grants.revoke': (id: string) => void;
  'grants.revokeAll': () => void;
  'grants.setFastSend': (a: { contactId: string; on: boolean }) => void;
  'visitors.list': () => { events: VisitorEvent[]; session: SessionEvent[] };
  'visitors.snapshot': (id: string) => string | null; // data URL
  'visitors.note': (a: { id: string; note: string }) => void;
  'visitors.markKnown': (a: { id: string; label: string }) => void;
  'visitors.delete': (id: string) => void;
  'visitors.deleteAll': () => void;
  'visitors.export': () => string;
  'visitors.report': () => void;
  'face.enrollStart': () => void;
  'face.enrollCancel': () => void;
  'face.enrollFinish': () => { matchThreshold: number; unknownCeiling: number };
  'face.delete': () => void;
  'voice.enrollStart': () => void;
  'voice.enrollCancel': () => void;
  'voice.enrollFinish': () => void;
  'voice.delete': () => void;
  'wake.calibrate': () => string[];
  'auth.setPin': (pin: string) => void;
  'auth.verifyPin': (pin: string) => boolean;
  'auth.cancel': () => void;
  'auth.hello': () => { available: boolean; result: string };
  'diag.run': () => DiagnosticItem[];
  'diag.test': (kind: 'stt' | 'tts' | 'llm' | 'whatsapp' | 'youtube' | 'speak') => { ok: boolean; detail: string };
  'models.status': () => ModelStatus[];
  'models.download': (id: string) => void;
  'models.remove': (id: string) => void;
  'whatsapp.show': () => void;
  'whatsapp.logout': () => void;
  'data.deleteEverything': () => void;
}

export type IpcEvents = {
  state: AssistantState;
  turn: ChatTurn;
  task: TaskInfo | null;
  pending: PendingInfo | null;
  draft: string;
  notice: { level: 'info' | 'warn' | 'error'; so: string; en: string };
  action: ActionRecord;
  devices: DeviceStatus;
  presence: PresenceSnapshot;
  micLevel: number;
  ttsLevel: number;
  enroll: EnrollUpdate;
  download: { id: string; received: number; total: number; done: boolean; error?: string };
  'visitors-changed': null;
  snapshot: Snapshot;
  authRequest: { reason: string; allowHello: boolean; pinSet: boolean } | null;
};

export interface AfuufowApi {
  invoke<K extends keyof IpcMethods>(name: K, ...args: Parameters<IpcMethods[K]>): Promise<ReturnType<IpcMethods[K]>>;
  on<K extends keyof IpcEvents>(name: K, cb: (payload: IpcEvents[K]) => void): () => void;
}

declare global {
  interface Window {
    afuufow: AfuufowApi;
  }
}
