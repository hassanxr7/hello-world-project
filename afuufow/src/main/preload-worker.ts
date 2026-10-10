import { contextBridge, ipcRenderer } from 'electron';

/** Minimal bridge for the hidden audio/vision pages. Only audio:* and vision:* channels are allowed. */
const ok = (c: string) => /^(audio|vision):[A-Za-z]+$/.test(c);
contextBridge.exposeInMainWorld('worker', {
  send(channel: string, payload?: unknown) {
    if (ok(channel)) ipcRenderer.send(channel, payload);
  },
  on(channel: string, cb: (p: unknown) => void) {
    if (ok(channel)) ipcRenderer.on(channel, (_e, p) => cb(p));
  },
});
