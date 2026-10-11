import { useSyncExternalStore } from 'react';
import type { PendingInfo, TaskInfo } from '../core/assistant/types';
import type { HandFrame } from '../core/vision/hands';
import type { EnrollUpdate, Snapshot } from '../shared/ipc';
import type { ActionRecord, AssistantState, ChatTurn } from '../shared/types';
import { api } from './api';

export interface Notice {
  id: number;
  level: 'info' | 'warn' | 'error';
  so: string;
  en: string;
}

export interface UiState {
  snap: Snapshot | null;
  turns: ChatTurn[];
  task: TaskInfo | null;
  pending: PendingInfo | null;
  draft: string | null;
  notices: Notice[];
  actions: ActionRecord[];
  enroll: EnrollUpdate | null;
  downloads: Record<string, { received: number; total: number; done: boolean; error?: string }>;
  auth: { reason: string; allowHello: boolean; pinSet: boolean } | null;
  state: AssistantState;
  visitorsTick: number;
}

let state: UiState = { snap: null, turns: [], task: null, pending: null, draft: null, notices: [], actions: [], enroll: null, downloads: {}, auth: null, state: 'sleeping', visitorsTick: 0 };
const subs = new Set<() => void>();
const set = (p: Partial<UiState>) => {
  state = { ...state, ...p };
  subs.forEach((f) => f());
};

export const levels = { mic: 0, tts: 0 };
const levelSubs = new Set<() => void>();
export function useLevels() {
  return useSyncExternalStore(
    (cb) => (levelSubs.add(cb), () => levelSubs.delete(cb)),
    () => levels,
  );
}

export function useUi<T>(sel: (s: UiState) => T): T {
  return useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => sel(state),
  );
}

let nid = 1;
const handSubs = new Set<(f: HandFrame) => void>();
/** Hand frames arrive ~15 times a second; they bypass React state on purpose. */
// test hook: feed hand frames straight into the UI (numbers only; it can do nothing but draw hands)
let syntheticAt = 0;
(window as unknown as Record<string, unknown>).__afuHandFrame = (f: HandFrame) => {
  syntheticAt = Date.now();
  handSubs.forEach((fn) => fn(f));
};

export function subscribeHands(fn: (f: HandFrame) => void) {
  handSubs.add(fn);
  return () => {
    handSubs.delete(fn);
  };
}

export function notify(level: Notice['level'], so: string, en: string) {
  // the same message shown again replaces the old one instead of piling up
  const n: Notice = { id: nid++, level, so, en };
  set({ notices: [...state.notices.filter((x) => x.so !== so || x.en !== en).slice(-2), n] });
  setTimeout(() => set({ notices: state.notices.filter((x) => x.id !== n.id) }), level === 'error' ? 9000 : 5000);
}
export const dismissNotice = (id: number) => set({ notices: state.notices.filter((n) => n.id !== id) });

export async function refresh() {
  set({ snap: await api.invoke('app.snapshot'), state: undefined as never });
}

let started = false;
export async function startStore() {
  if (started) return;
  started = true;
  api.on('snapshot', (s) => set({ snap: s, state: s.state }));
  api.on('state', (s) => set({ state: s }));
  api.on('turn', (t) => set({ turns: [...state.turns.filter((x) => x.id !== t.id), t].slice(-300) }));
  api.on('task', (t) => set({ task: t }));
  api.on('pending', (p) => set({ pending: p }));
  api.on('draft', (d) => set({ draft: d }));
  api.on('notice', (n) => notify(n.level, n.so, n.en));
  api.on('hands', (f) => {
    if (Date.now() - syntheticAt < 1000) return; // a test is feeding synthetic frames: do not mix in the live ones
    handSubs.forEach((fn) => fn(f));
  });
  api.on('action', (a) => set({ actions: [a, ...state.actions.filter((x) => x.id !== a.id)].slice(0, 300) }));
  api.on('devices', (d) => state.snap && set({ snap: { ...state.snap, devices: d } }));
  api.on('presence', (p) => state.snap && set({ snap: { ...state.snap, presence: p } }));
  api.on('micLevel', (l) => {
    levels.mic = l;
    levelSubs.forEach((f) => f());
  });
  api.on('ttsLevel', (l) => {
    levels.tts = l;
    levelSubs.forEach((f) => f());
  });
  api.on('enroll', (e) => set({ enroll: e }));
  api.on('download', (d) => set({ downloads: { ...state.downloads, [d.id]: d } }));
  api.on('authRequest', (a) => set({ auth: a }));
  api.on('visitors-changed', () => set({ visitorsTick: state.visitorsTick + 1 }));
  const snap = await api.invoke('app.snapshot');
  const [turns, actions] = await Promise.all([api.invoke('history.get', 100), api.invoke('actions.get')]);
  set({ snap, state: snap.state, turns, actions });
}

export async function call<K extends keyof import('../shared/ipc').IpcMethods>(name: K, ...args: Parameters<import('../shared/ipc').IpcMethods[K]>) {
  try {
    return await api.invoke(name, ...args);
  } catch (e) {
    const m = (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '');
    notify('error', m, m);
    throw e;
  }
}

export const patchSettings = (p: Record<string, unknown>) => call('settings.update', p).catch(() => undefined);
