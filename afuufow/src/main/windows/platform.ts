import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FoundFile, InstalledApp, Platform, WindowInfo } from '../../core/platform';
import type { RunPowerShell } from '../../core/speech/tts/sapi';
import { findFiles } from './findfiles';
import { runJson } from './ps';
import { SCRIPTS, withParams } from './scripts';

export interface ElectronBridge {
  openExternal(url: string): Promise<void>;
  openPath(p: string): Promise<string>;
  captureScreenPng(): Promise<Buffer>;
  clipboardWrite(t: string): void | Promise<void>;
  clipboardRead(): string | Promise<string>;
  knownFolder(name: 'downloads' | 'documents' | 'desktop' | 'pictures' | 'music' | 'videos'): string;
}

/** The real Windows implementation of Platform. Everything here is Windows-only behaviour and is exercised by the Windows CI smoke test. */
export class WindowsPlatform implements Platform {
  private appCache: { at: number; apps: InstalledApp[] } | null = null;
  constructor(
    private run: RunPowerShell,
    private el: ElectronBridge,
  ) {}

  private json<T>(script: string, params: unknown, signal?: AbortSignal, timeoutMs = 30_000) {
    return runJson<T>(this.run, withParams(script, params), { signal, timeoutMs });
  }

  async listApps(signal?: AbortSignal): Promise<InstalledApp[]> {
    if (this.appCache && Date.now() - this.appCache.at < 5 * 60_000) return this.appCache.apps;
    const raw = await this.json<Array<{ name: string; id: string }> | { name: string; id: string } | null>(SCRIPTS.listApps, {}, signal, 40_000);
    const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const apps = arr
      .filter((a) => a && a.name && a.id)
      .map((a): InstalledApp => ({ name: a.name, id: a.id, kind: a.id.includes('!') ? 'uwp' : /^[A-Za-z]:\\/.test(a.id) ? 'exe' : 'uwp' }));
    this.appCache = { at: Date.now(), apps };
    return apps;
  }

  async launchApp(app: InstalledApp, signal?: AbortSignal): Promise<void> {
    await this.json(SCRIPTS.launchApp, { id: app.id, kind: app.kind }, signal, 20_000);
  }

  async waitForWindow(needles: string[], timeoutMs: number, signal?: AbortSignal): Promise<WindowInfo | null> {
    return this.json<WindowInfo | null>(SCRIPTS.waitForWindow, { needles, timeoutMs }, signal, timeoutMs + 8000);
  }

  async foregroundWindow(): Promise<WindowInfo | null> {
    return this.json<WindowInfo | null>(SCRIPTS.foregroundWindow, {});
  }

  knownFolder(label: string): string | null {
    try {
      return this.el.knownFolder(label as 'downloads');
    } catch {
      return null;
    }
  }
  pathExists(p: string): boolean {
    return fs.existsSync(p);
  }
  async openPath(p: string): Promise<void> {
    const err = await this.el.openPath(p);
    if (err) throw new Error(err);
  }

  async openUrl(url: string, browser: 'default' | 'chrome' | 'edge' | 'firefox'): Promise<void> {
    if (browser !== 'default') {
      const r = await this.json<{ ok: boolean }>(SCRIPTS.openInBrowser, { url, browser });
      if (r?.ok) return;
    }
    await this.el.openExternal(url);
  }

  findFiles(query: string, roots: string[], limit: number, signal?: AbortSignal): Promise<FoundFile[]> {
    return findFiles(query, roots, limit, signal);
  }

  async screenshot(dir: string): Promise<{ path: string; bytes: number }> {
    const png = await this.el.captureScreenPng();
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const file = path.join(dir, `screenshot_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.png`);
    fs.writeFileSync(file, png);
    return { path: file, bytes: fs.statSync(file).size };
  }

  async getVolume() {
    const r = await this.json<{ level: number; muted: boolean }>(SCRIPTS.setVolume, {});
    return r;
  }
  async setVolume(level: number) {
    await this.json(SCRIPTS.setVolume, { level });
  }
  async setMute(muted: boolean) {
    await this.json(SCRIPTS.setVolume, { muted });
  }
  async mediaKey(key: 'playpause' | 'next' | 'previous' | 'stop') {
    await this.json(SCRIPTS.mediaKey, { key });
  }

  async clipboardWrite(t: string) {
    await this.el.clipboardWrite(t);
  }
  async clipboardRead() {
    return await this.el.clipboardRead();
  }
  async focusWindow(needles: string[]) {
    const r = await this.json<{ ok: boolean }>(SCRIPTS.focusWindow, { needles });
    return !!r?.ok;
  }
  async sendPaste() {
    await this.json(SCRIPTS.sendPaste, {});
  }
  async focusedText() {
    try {
      const r = await this.json<{ text: string }>(SCRIPTS.focusedText, {});
      return r?.text ?? '';
    } catch {
      return '';
    }
  }
  async windowText(signal?: AbortSignal) {
    try {
      const r = await this.json<{ text: string }>(SCRIPTS.windowText, {}, signal, 30_000);
      return r?.text ?? '';
    } catch {
      return '';
    }
  }
  async ocr(imagePath: string, signal?: AbortSignal) {
    const r = await this.json<{ text: string }>(SCRIPTS.ocr, { path: imagePath }, signal, 40_000);
    return r?.text ?? '';
  }
  async recycle(p: string) {
    await this.json(SCRIPTS.recycle, { path: p });
  }
  async wingetInstall(id: string, signal?: AbortSignal) {
    const r = await this.json<{ ok: boolean; output: string }>(SCRIPTS.wingetInstall, { id }, signal, 590_000);
    return r ?? { ok: false, output: '' };
  }
  async wingetHas(id: string) {
    const r = await this.json<{ has: boolean }>(SCRIPTS.wingetHas, { id }, undefined, 60_000);
    return !!r?.has;
  }
}
