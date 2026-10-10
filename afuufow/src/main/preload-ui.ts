import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('afuufow', {
  invoke(name: string, ...args: unknown[]) {
    return ipcRenderer.invoke('afu:invoke', name, args).then((r: { ok: boolean; value?: unknown; error?: string }) => {
      if (!r.ok) throw new Error(r.error);
      return r.value;
    });
  },
  on(name: string, cb: (p: unknown) => void) {
    const h = (_e: unknown, event: string, payload: unknown) => {
      if (event === name) cb(payload);
    };
    ipcRenderer.on('afu:event', h);
    return () => ipcRenderer.removeListener('afu:event', h);
  },
});
