import * as path from 'node:path';
import { BrowserWindow, app, ipcMain, session } from 'electron';
import type { AudioClip, AudioPlayer } from '../core/speech/tts/types';
import type { FrameObs } from '../core/vision/presence';

function makeWorkerWindow(page: string): BrowserWindow {
  const ses = session.fromPartition('persist:afuufow-workers');
  // The hidden pages may use ONLY the microphone/camera, and only when loaded from our own bundle.
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'media' && wc.getURL().startsWith('file://')));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  const w = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    webPreferences: {
      session: ses,
      preload: path.join(app.getAppPath(), 'dist', 'main', 'preload-worker.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  void w.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'workers', page));
  return w;
}

export interface MediaStatus {
  capturing: boolean;
  error?: string;
  kind?: 'blocked' | 'missing' | 'busy' | 'error';
  label?: string;
  loading?: boolean;
  backend?: string;
}

export class AudioBridge implements AudioPlayer {
  private win: BrowserWindow | null = null;
  private seq = 1;
  private waiting = new Map<number, () => void>();
  private ready: Promise<void> = Promise.resolve();
  private onFrameCb: (f: Float32Array) => void = () => undefined;
  private onStatusCb: (s: MediaStatus) => void = () => undefined;
  private onLevelCb: (l: number) => void = () => undefined;
  private devicesResolve: ((d: Array<{ id: string; label: string; kind: string }>) => void) | null = null;
  outputDeviceId: string | null = null;
  volume = 1;

  constructor() {
    ipcMain.on('audio:frame', (e, buf: ArrayBuffer) => {
      if (this.win && e.sender === this.win.webContents) this.onFrameCb(new Float32Array(buf));
    });
    ipcMain.on('audio:status', (e, s: MediaStatus) => {
      if (this.win && e.sender === this.win.webContents) this.onStatusCb(s);
    });
    ipcMain.on('audio:level', (e, l: number) => {
      if (this.win && e.sender === this.win.webContents) this.onLevelCb(l);
    });
    ipcMain.on('audio:ended', (e, m: { id: number }) => {
      if (this.win && e.sender === this.win.webContents) this.waiting.get(m.id)?.();
    });
    ipcMain.on('audio:devices', (e, d) => {
      if (this.win && e.sender === this.win.webContents) this.devicesResolve?.(d);
    });
  }

  onFrame(cb: (f: Float32Array) => void) { this.onFrameCb = cb; }
  onStatus(cb: (s: MediaStatus) => void) { this.onStatusCb = cb; }
  onLevel(cb: (l: number) => void) { this.onLevelCb = cb; }

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const w = makeWorkerWindow('audio.html');
    this.ready = new Promise<void>((res) => ipcMain.once('audio:ready', () => res()));
    w.webContents.on('render-process-gone', () => {
      this.win = null;
      this.onStatusCb({ capturing: false, error: 'audio process crashed; it will restart on demand' });
      for (const [, f] of this.waiting) f();
      this.waiting.clear();
    });
    this.win = w;
    return w;
  }

  private async send(channel: string, payload?: unknown) {
    const w = this.ensure();
    await this.ready;
    w.webContents.send(channel, payload);
  }

  async start(deviceId: string | null) { await this.send('audio:start', { deviceId }); }
  async stopCapture() { if (this.win && !this.win.isDestroyed()) this.win.webContents.send('audio:stop'); }

  async devices(): Promise<Array<{ id: string; label: string; kind: string }>> {
    const p = new Promise<Array<{ id: string; label: string; kind: string }>>((res) => (this.devicesResolve = res));
    await this.send('audio:devices');
    return Promise.race([p, new Promise<[]>((r) => setTimeout(() => r([]), 3000))]);
  }

  async play(clip: AudioClip, signal?: AbortSignal): Promise<void> {
    const id = this.seq++;
    const done = new Promise<void>((resolve) => {
      this.waiting.set(id, () => {
        this.waiting.delete(id);
        resolve();
      });
    });
    signal?.addEventListener('abort', () => this.stop(), { once: true });
    const data = clip.data.buffer.slice(clip.data.byteOffset, clip.data.byteOffset + clip.data.byteLength);
    await this.send('audio:play', { id, mime: clip.mime, data, volume: this.volume, sinkId: this.outputDeviceId });
    await done;
  }

  stop(): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('audio:stopPlayback');
  }

  destroy() {
    this.win?.destroy();
    this.win = null;
  }
}

export class VisionBridge {
  private win: BrowserWindow | null = null;
  private ready: Promise<void> = Promise.resolve();
  private onFrameCb: (f: FrameObs) => void = () => undefined;
  private onStatusCb: (s: MediaStatus) => void = () => undefined;
  private onEnrollCb: (m: { samples: any[]; luminance: number; faceVisible: boolean }) => void = () => undefined;
  private onHandsCb: (f: unknown) => void = () => undefined;
  private handsWanted = false;
  private snaps = new Map<number, (d: string | null) => void>();
  private seq = 1;
  private devicesResolve: ((d: Array<{ id: string; label: string }>) => void) | null = null;

  constructor() {
    const own = (e: Electron.IpcMainEvent) => !!this.win && e.sender === this.win.webContents;
    ipcMain.on('vision:frame', (e, f: FrameObs) => own(e) && this.onFrameCb(f));
    ipcMain.on('vision:status', (e, s: MediaStatus) => own(e) && this.onStatusCb(s));
    ipcMain.on('vision:hands', (e, f) => own(e) && this.onHandsCb(f));
    ipcMain.on('vision:enrollSamples', (e, m) => own(e) && this.onEnrollCb(m));
    ipcMain.on('vision:snapshot', (e, m: { id: number; data: string | null }) => own(e) && this.snaps.get(m.id)?.(m.data));
    ipcMain.on('vision:devices', (e, d) => own(e) && this.devicesResolve?.(d));
  }

  onFrame(cb: (f: FrameObs) => void) { this.onFrameCb = cb; }
  onStatus(cb: (s: MediaStatus) => void) { this.onStatusCb = cb; }
  onEnroll(cb: (m: { samples: any[]; luminance: number; faceVisible: boolean }) => void) { this.onEnrollCb = cb; }
  onHands(cb: (f: unknown) => void) { this.onHandsCb = cb; }
  /** Hand tracking runs in the camera worker only while wanted; the flag is remembered and re-sent whenever the camera starts. */
  setHands(on: boolean) {
    this.handsWanted = on;
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('vision:handsSet', { on });
  }

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const w = makeWorkerWindow('vision.html');
    this.ready = new Promise<void>((res) => ipcMain.once('vision:ready', () => res()));
    w.webContents.on('render-process-gone', () => {
      this.win = null;
      this.onStatusCb({ capturing: false, error: 'camera process crashed; it will restart when monitoring is turned on again' });
    });
    this.win = w;
    return w;
  }
  private async send(channel: string, payload?: unknown) {
    const w = this.ensure();
    await this.ready;
    w.webContents.send(channel, payload);
  }

  async start(deviceId: string | null, fps: number) {
    await this.send('vision:handsSet', { on: this.handsWanted });
    await this.send('vision:start', { deviceId, fps });
  }
  async stop() { if (this.win && !this.win.isDestroyed()) this.win.webContents.send('vision:stop'); }
  async setTemplates(owner: number[][], known: Array<{ id: string; templates: number[][] }>) { await this.send('vision:templates', { owner, known }); }
  async setEnroll(on: boolean) { await this.send('vision:enroll', { on }); }
  async snapshot(): Promise<Buffer | null> {
    const id = this.seq++;
    const p = new Promise<string | null>((res) => this.snaps.set(id, res));
    await this.send('vision:snapshot', { id });
    const data = await Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
    this.snaps.delete(id);
    return data ? Buffer.from(data.split(',')[1]!, 'base64') : null;
  }
  async devices(): Promise<Array<{ id: string; label: string }>> {
    const p = new Promise<Array<{ id: string; label: string }>>((res) => (this.devicesResolve = res));
    await this.send('vision:devices');
    return Promise.race([p, new Promise<[]>((r) => setTimeout(() => r([]), 3000))]);
  }
  destroy() {
    this.win?.destroy();
    this.win = null;
  }
}
