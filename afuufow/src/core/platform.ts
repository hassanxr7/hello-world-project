/** Everything the assistant needs from the operating system. The real implementation drives Windows via PowerShell/Electron; tests use a fake. */

export interface InstalledApp {
  name: string;
  /** exe path, .lnk path, or UWP AppUserModelID */
  id: string;
  kind: 'exe' | 'shortcut' | 'uwp';
}

export interface FoundFile {
  path: string;
  name: string;
  modified: number;
  size: number;
}

export interface WindowInfo {
  title: string;
  processName: string;
  pid: number;
}

export interface Platform {
  listApps(signal?: AbortSignal): Promise<InstalledApp[]>;
  launchApp(app: InstalledApp, signal?: AbortSignal): Promise<void>;
  /** Wait until a top-level window whose title or process name contains one of the needles exists. */
  waitForWindow(needles: string[], timeoutMs: number, signal?: AbortSignal): Promise<WindowInfo | null>;
  foregroundWindow(): Promise<WindowInfo | null>;
  knownFolder(label: string): string | null;
  pathExists(p: string): boolean;
  /** Canonical path after resolving junctions/symlinks (for containment checks). */
  realPath(p: string): string;
  openPath(p: string): Promise<void>;
  openUrl(url: string, browser: 'default' | 'chrome' | 'edge' | 'firefox'): Promise<void>;
  findFiles(query: string, roots: string[], limit: number, signal?: AbortSignal): Promise<FoundFile[]>;
  screenshot(dir: string): Promise<{ path: string; bytes: number }>;
  getVolume(): Promise<{ level: number; muted: boolean }>;
  setVolume(level: number): Promise<void>;
  setMute(muted: boolean): Promise<void>;
  mediaKey(key: 'playpause' | 'next' | 'previous' | 'stop'): Promise<void>;
  clipboardWrite(text: string): Promise<void>;
  clipboardRead(): Promise<string>;
  focusWindow(needles: string[]): Promise<boolean>;
  sendPaste(): Promise<void>;
  /** Text of the focused control (UI Automation), '' if unavailable. */
  focusedText(): Promise<string>;
  /** Text visible in the foreground window via UI Automation. */
  windowText(signal?: AbortSignal): Promise<string>;
  /** Windows OCR on a screenshot file. */
  ocr(imagePath: string, signal?: AbortSignal): Promise<string>;
  recycle(path: string): Promise<void>;
  wingetInstall(id: string, signal?: AbortSignal): Promise<{ ok: boolean; output: string }>;
  wingetHas(id: string): Promise<boolean>;
}

export interface YtCandidate {
  id: string;
  title: string;
  channel: string;
  durationText?: string;
  /** 0..1 match to the requested query */
  score: number;
}

export interface YtPlayback {
  playing: boolean;
  paused: boolean;
  adShowing: boolean;
  title: string;
  position: number;
  volume: number;
}

export interface YouTubeController {
  search(query: string, kind: 'song' | 'video' | 'any', signal?: AbortSignal): Promise<YtCandidate[]>;
  /** Open in the controlled player window and report what the page itself says. */
  play(videoId: string, signal?: AbortSignal): Promise<YtPlayback>;
  control(action: 'pause' | 'resume' | 'volumeUp' | 'volumeDown' | 'setVolume' | 'next' | 'stop', arg?: number): Promise<YtPlayback | null>;
  status(): Promise<YtPlayback | null>;
}

export type WaStatus = 'ready' | 'qr_required' | 'loading' | 'unavailable';
export type WaDelivery = 'pending' | 'sent' | 'delivered' | 'read' | 'unknown';

export interface WhatsAppController {
  /** What this integration can really observe. Desktop deep-link mode cannot read the composer or the chat. */
  readonly caps: { verifyComposer: boolean; canSend: boolean; verifyDelivery: boolean };
  status(signal?: AbortSignal): Promise<WaStatus>;
  show(): Promise<void>;
  openChat(phone: string, signal?: AbortSignal): Promise<{ ok: boolean; reason?: string; chatTitle?: string }>;
  /** Put text in the composer WITHOUT sending, then read it back. */
  setDraft(text: string, signal?: AbortSignal): Promise<{ ok: boolean; observed: string }>;
  clickSend(signal?: AbortSignal): Promise<{ ok: boolean }>;
  /** Look for an outgoing message with this text that appeared after `since` (ms epoch). */
  findOutgoing(text: string, since: number, signal?: AbortSignal): Promise<{ found: boolean; delivery: WaDelivery }>;
}

export interface LlmClient {
  /** One-shot completion used for drafting and summarising. */
  complete(system: string, user: string, opts?: { signal?: AbortSignal; json?: boolean }): Promise<string>;
  /** True if this call would leave the machine (cloud provider). */
  isCloud(): boolean;
}
