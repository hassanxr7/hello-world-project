import { BrowserWindow } from 'electron';
import type { PageDriver } from './web';

/** BrowserWindow-backed PageDriver for WhatsApp Web, with its own persistent profile (QR scanned once). */
export class ElectronPageDriver implements PageDriver {
  private win: BrowserWindow | null = null;

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const w = new BrowserWindow({
      width: 1000,
      height: 720,
      show: false,
      title: 'Afuufow — WhatsApp Web',
      autoHideMenuBar: true,
      webPreferences: { partition: 'persist:whatsapp', sandbox: true, contextIsolation: true, backgroundThrottling: false, nodeIntegration: false },
    });
    // WhatsApp Web refuses unknown browsers; present as the Chromium this app embeds, without the "Electron/" token.
    w.webContents.setUserAgent(w.webContents.getUserAgent().replace(/\s?Electron\/\S+/, '').replace(/\s?afuufow\/\S+/i, ''));
    w.on('close', (e) => {
      // keep the session alive in the background; the window is only hidden
      if (!(globalThis as { __afuQuitting?: boolean }).__afuQuitting) {
        e.preventDefault();
        w.hide();
      }
    });
    w.on('closed', () => (this.win = null));
    this.win = w;
    return w;
  }

  async load(url: string) {
    const w = this.ensure();
    await w.loadURL(url);
  }
  currentUrl() {
    return this.win && !this.win.isDestroyed() ? this.win.webContents.getURL() : '';
  }
  async eval<T>(js: string): Promise<T> {
    return (await this.ensure().webContents.executeJavaScript(js)) as T;
  }
  async insertText(text: string) {
    await this.ensure().webContents.insertText(text);
  }
  async pressKey(key: 'Enter' | 'Shift+Enter') {
    const wc = this.ensure().webContents;
    const modifiers = key === 'Shift+Enter' ? (['shift'] as const) : ([] as const);
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return', modifiers: [...modifiers] });
    wc.sendInputEvent({ type: 'char', keyCode: 'Return', modifiers: [...modifiers] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return', modifiers: [...modifiers] });
  }
  async show() {
    const w = this.ensure();
    if (!w.webContents.getURL()) await w.loadURL('https://web.whatsapp.com/');
    w.show();
    w.focus();
  }
  /** Sign out: wipe the profile of this window. */
  async clearSession() {
    const w = this.ensure();
    await w.webContents.session.clearStorageData();
    await w.webContents.session.clearCache();
    w.destroy();
    this.win = null;
  }
}
