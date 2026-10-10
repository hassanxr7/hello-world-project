import * as path from 'node:path';
import { BrowserWindow, Menu, Tray, app, nativeImage, shell } from 'electron';
import type { IpcEvents } from '../shared/ipc';
import type { Hub, Runtime } from './runtime';

export const quitting = { value: false };

/** Owns the visible UI window and the tray icon. Closing the window never exits the assistant: it keeps running in the tray. */
export class WindowManager implements Hub {
  private win: BrowserWindow | null = null;
  private tray: Tray | null = null;
  private rt: Runtime | null = null;
  private iconDir = path.join(app.getAppPath(), 'resources');

  attach(rt: Runtime) {
    this.rt = rt;
  }

  send<K extends keyof IpcEvents>(name: K, payload: IpcEvents[K]): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('afu:event', name, payload);
  }

  showMainWindow(): void {
    const w = this.ensureWindow();
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  }

  hideMainWindow() {
    this.win?.hide();
  }

  ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const w = new BrowserWindow({
      width: 1180,
      height: 780,
      minWidth: 900,
      minHeight: 620,
      show: false,
      title: 'Afuufow',
      icon: nativeImage.createFromPath(path.join(this.iconDir, 'icon.png')),
      backgroundColor: '#0b1020',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(app.getAppPath(), 'dist', 'main', 'preload-ui.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    w.removeMenu();
    // The UI only ever loads our own bundled files; any other navigation is refused and links open in the system browser.
    w.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith('file://')) {
        e.preventDefault();
        if (/^https:\/\//.test(url)) void shell.openExternal(url);
      }
    });
    w.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    w.webContents.session.setPermissionRequestHandler((_wc, _p, cb) => cb(false)); // the UI itself needs no device access
    w.on('close', (e) => {
      if (!quitting.value) {
        e.preventDefault();
        w.hide();
      }
    });
    w.on('closed', () => (this.win = null));
    w.webContents.on('did-finish-load', () => {
      if (this.rt) w.webContents.send('afu:event', 'snapshot', this.rt.snapshot());
    });
    w.webContents.on('render-process-gone', (_e, d) => {
      this.rt?.['log']?.warn?.('UI renderer gone: ' + d.reason);
      this.win = null;
      if (!quitting.value) setTimeout(() => this.ensureWindow(), 1000); // recover from a UI crash
    });
    void w.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'));
    this.win = w;
    return w;
  }

  createTray() {
    const img = (n: string) => nativeImage.createFromPath(path.join(this.iconDir, n)).resize({ width: 16, height: 16 });
    this.tray = new Tray(img('tray.png'));
    this.tray.on('click', () => this.showMainWindow());
    this.updateTray();
  }

  updateTray(): void {
    if (!this.tray || !this.rt) return;
    const rt = this.rt;
    const s = rt.settings.get();
    const d = rt.devices();
    const so = s.general.uiLanguage === 'so';
    const t = (a: string, b: string) => (so ? a : b);
    const mic = d.micEnabled ? (d.micCapturing ? t('Shaqeynaya', 'listening') : t('Khalad', 'error')) : t('Dansan', 'off');
    const cam = d.cameraEnabled ? (d.cameraCapturing ? t('Shaqeynaya', 'watching') : t('Khalad', 'error')) : t('Dansan', 'off');
    this.tray.setToolTip(`Afuufow — ${t('Maykarafoon', 'Mic')}: ${mic} · ${t('Kamarad', 'Camera')}: ${cam}`);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: t('Fur Afuufow', 'Open Afuufow'), click: () => this.showMainWindow() },
        { type: 'separator' },
        { label: `${t('Maykarafoon', 'Microphone')}: ${mic}`, type: 'checkbox', checked: d.micEnabled, click: () => void rt.setMic(!rt.settings.get().audio.micEnabled).catch((e) => rt['notice']('error', String(e.message), String(e.message))) },
        { label: `${t('Kamarad', 'Camera')}: ${cam}`, type: 'checkbox', checked: d.cameraEnabled, click: () => void rt.setCamera(!rt.settings.get().camera.enabled).catch((e) => rt['notice']('error', String(e.message), String(e.message))) },
        { label: t('Jooji hadalka / hawsha', 'Stop speaking / task'), click: () => rt.stopEverything() },
        { label: t('Ku hadal (push-to-talk)', 'Push to talk'), click: () => rt.pttToggle() },
        { type: 'separator' },
        { label: t('Bilow marka Windows furmo', 'Start with Windows'), type: 'checkbox', checked: app.getLoginItemSettings({ args: ['--background'] }).openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--background'] }) },
        { type: 'separator' },
        { label: t('Ka bax Afuufow', 'Exit Afuufow'), click: () => app.quit() },
      ]),
    );
  }

  destroy() {
    this.tray?.destroy();
    this.win?.destroy();
  }
}
