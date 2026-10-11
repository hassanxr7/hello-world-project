import { app, ipcMain, shell } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IpcMethods } from '../shared/ipc';
import { SECRET } from '../core/storage/secrets';
import type { Runtime } from './runtime';
import type { Logger } from './logger';

type Handlers = { [K in keyof IpcMethods]: (...a: Parameters<IpcMethods[K]>) => ReturnType<IpcMethods[K]> | Promise<ReturnType<IpcMethods[K]>> };

const ALLOWED_SECRETS = new Set<string>(Object.values(SECRET).filter((n) => n !== SECRET.ownerPinHash));

export function registerIpc(rt: Runtime, log: Logger) {
  const h: Handlers = {
    'app.snapshot': () => rt.snapshot(),
    'app.quit': () => app.quit(),
    'app.openLogs': () => void shell.openPath(log.path),
    'app.setLoginItem': (on) => {
      app.setLoginItemSettings({ openAtLogin: on, args: ['--background'] });
      rt.settings.update({ general: { startWithWindows: on } });
    },
    'app.completeSetup': ({ approveDefaultFolders }) => {
      const patch: Record<string, unknown> = { setupComplete: true };
      if (approveDefaultFolders) {
        const have = rt.settings.get().permissions.approvedFolders;
        const add = (['downloads', 'documents', 'desktop'] as const).map((n) => ({ label: n, path: app.getPath(n) })).filter((f) => !have.some((h) => h.path === f.path));
        patch.permissions = { approvedFolders: [...have, ...add] };
      }
      rt.settings.update(patch);
      rt.hub_snapshot();
    },
    'cmd.text': (t) => rt.submitText(String(t).slice(0, 4000)) as never,
    'cmd.stop': () => rt.stopEverything(),
    'cmd.cancelTask': () => rt.assistant.cancelTask(),
    'cmd.answer': (a) => rt.answer(a),
    'cmd.pttToggle': () => rt.pttToggle(),
    'mic.set': (on) => rt.setMic(on) as never,
    'cam.set': (on) => rt.setCamera(on) as never,
    'speaker.set': (on) => {
      rt.settings.update({ audio: { speakerEnabled: on } });
      if (!on) rt.speech.stop();
      rt['pushDevices']();
    },
    'settings.update': (patch) => {
      const s = rt.settings.update(patch);
      rt.hub_snapshot();
      return s;
    },
    'secret.set': ({ name, value }) => {
      if (!ALLOWED_SECRETS.has(name)) throw new Error('unknown secret');
      rt.secrets.set(name, value.trim());
      rt.hub_snapshot();
    },
    'secret.delete': (name) => {
      if (!ALLOWED_SECRETS.has(name)) throw new Error('unknown secret');
      rt.secrets.delete(name);
      rt.hub_snapshot();
    },
    'profile.set': (p) => {
      rt.memory.setOwner(p);
      rt.hub_snapshot();
    },
    'memory.get': () => ({ facts: rt.memory.doc.facts, preferences: rt.memory.doc.preferences, favorites: rt.memory.doc.favorites }),
    'memory.addFact': (t) => void rt.memory.addFact(t, 'owner'),
    'memory.correctFact': ({ id, text }) => void rt.memory.correctFact(id, text),
    'memory.deleteFact': (id) => void rt.memory.deleteFact(id),
    'memory.export': () => rt.memory.exportAll(),
    'memory.wipe': () => rt.memory.wipeAll() as never,
    'history.get': (limit) => rt.memory.recentTurns(limit ?? 200),
    'history.clear': () => rt.memory.clearHistory(),
    'actions.get': () => rt.actionLog.list(300),
    'actions.clear': () => rt.actionLog.clear(),
    'actions.export': () => rt.actionLog.export(),
    'contacts.list': () => rt.memory.contacts,
    'contacts.upsert': (c) => {
      const saved = rt.memory.upsertContact(c);
      rt.grants.setFastSend(saved.id, saved.approved && saved.fastSend);
      return saved;
    },
    'contacts.delete': (id) => {
      rt.memory.deleteContact(id);
      rt.grants.setFastSend(id, false);
    },
    'grants.list': () => rt.grants.list(),
    'grants.revoke': (id) => rt.grants.revoke(id),
    'grants.revokeAll': () => rt.grants.revokeAll(),
    'grants.setFastSend': ({ contactId, on }) => {
      const c = rt.memory.contacts.find((x) => x.id === contactId);
      if (on && !c?.approved) throw new Error('Approve the contact first');
      rt.grants.setFastSend(contactId, on);
      if (c) rt.memory.upsertContact({ ...c, fastSend: on });
    },
    'visitors.list': () => ({ events: rt.visitorLog.list(), session: rt.visitorLog.sessionEvents() }),
    'visitors.snapshot': async (id) => {
      const ev = rt.visitorLog.get(id);
      if (!ev?.snapshotId) return null;
      const b = await rt.visitorLog.blobs.get(ev.snapshotId);
      return b ? `data:image/jpeg;base64,${b.toString('base64')}` : null;
    },
    'visitors.note': ({ id, note }) => rt.visitorLog.addNote(id, note),
    'visitors.markKnown': ({ id, label }) => rt.visitorLog.markKnown(id, label),
    'visitors.delete': (id) => rt.visitorLog.delete(id),
    'visitors.deleteAll': () => rt.visitorLog.deleteAll(),
    'visitors.export': () => rt.visitorLog.exportAll(),
    'visitors.report': () => void rt.assistant.reportVisitors(true),
    'face.enrollStart': (label) => rt.faceEnrollStart(label),
    'face.known': () => rt.faces.info().known,
    'face.removeKnown': (id) => {
      rt.faces.removeKnown(id);
      void rt['pushTemplates']();
    },
    'face.enrollCancel': () => rt.faceEnrollCancel(),
    'face.enrollFinish': () => rt.faceEnrollFinish(),
    'face.delete': () => rt.faceDelete(),
    'voice.enrollStart': () => rt.voiceEnrollStart(),
    'voice.enrollCancel': () => rt.voiceEnrollCancel(),
    'voice.enrollFinish': () => rt.voiceEnrollFinish(),
    'voice.delete': () => rt.voiceDelete(),
    'wake.calibrate': () => rt.calibrateWake(),
    'auth.setPin': (pin) => {
      rt.setPin(pin);
      rt.hub_snapshot();
    },
    'auth.verifyPin': (pin) => rt.verifyPin(pin),
    'auth.cancel': () => rt.cancelAuth(),
    'auth.hello': () => rt.helloVerify(),
    'diag.run': () => rt.diagnostics(),
    'diag.test': (k) => rt.testProvider(k),
    'hands.stage': (open) => rt.setHandStage(open),
    'agent.status': () => rt.agentStatus(),
    'agent.install': () => void rt.installAgent().catch((e) => log.warn('agent install: ' + (e as Error).message)),
    'agent.cancelInstall': () => rt.cancelAgentInstall(),
    'agent.remove': () => rt.removeAgent(),
    'agent.test': () => rt.testAgent(),
    'models.status': () => rt.models.status(),
    'models.download': (id) => void rt.downloadModel(id).catch((e) => log.warn('model download: ' + (e as Error).message)),
    'models.remove': (id) => rt.removeModel(id),
    'whatsapp.show': () => rt.services.whatsapp.show(),
    'whatsapp.logout': () => rt.pageDriver.clearSession(),
    'data.deleteEverything': () => rt.deleteEverything(),
  };

  ipcMain.handle('afu:invoke', async (event, name: string, args: unknown[]) => {
    // only our own bundled UI window may call the API
    if (!event.senderFrame?.url.startsWith('file://')) return { ok: false, error: 'forbidden' };
    const fn = (h as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
    if (!fn) return { ok: false, error: 'unknown method ' + name };
    try {
      return { ok: true, value: await fn(...(args ?? [])) };
    } catch (e) {
      log.warn(`ipc ${name} failed: ${(e as Error).message}`);
      return { ok: false, error: (e as Error).message };
    }
  });
  void fs;
  void path;
}
