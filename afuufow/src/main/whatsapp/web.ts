import type { WaDelivery, WaStatus, WhatsAppController } from '../../core/platform';
import { sleep, throwIfAborted } from '../../core/util';
import { WA_PAGE_SCRIPT } from './page';

/** Abstraction of the browser window so the logic is testable without Electron. */
export interface PageDriver {
  load(url: string): Promise<void>;
  currentUrl(): string;
  eval<T>(js: string): Promise<T>;
  /** trusted keyboard/text input into the focused element */
  insertText(text: string): Promise<void>;
  pressKey(key: 'Enter' | 'Shift+Enter'): Promise<void>;
  show(): Promise<void>;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const call = <T>(d: PageDriver, expr: string) => d.eval<T>(`${WA_PAGE_SCRIPT}; window.__afu.${expr}`);

/**
 * Authenticated WhatsApp Web session in an app-owned window (persistent profile, QR scanned once).
 * NOTE: WhatsApp's terms restrict automated use of its services. Afuufow only acts on the owner's explicit
 * command, one message at a time, and enforces a send-rate limit; the owner accepts that risk in Settings.
 */
export class WhatsAppWeb implements WhatsAppController {
  readonly caps = { verifyComposer: true, canSend: true, verifyDelivery: true };
  private sentTimes: number[] = [];
  private preSendIds = new Set<string>();

  constructor(
    private page: PageDriver,
    private now: () => number = Date.now,
    private limits = { minGapMs: 3000, perHour: 20 },
  ) {}

  private async ensureLoaded(signal?: AbortSignal) {
    if (!this.page.currentUrl().startsWith('https://web.whatsapp.com')) await this.page.load('https://web.whatsapp.com/');
    throwIfAborted(signal);
  }

  async status(signal?: AbortSignal): Promise<WaStatus> {
    try {
      await this.ensureLoaded(signal);
      for (let i = 0; i < 40; i++) {
        const st = await call<WaStatus>(this.page, 'status()');
        if (st !== 'loading') return st;
        await sleep(500, signal);
      }
      return 'loading';
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      return 'unavailable';
    }
  }

  show() {
    return this.page.show();
  }

  async openChat(phone: string, signal?: AbortSignal) {
    if (!/^\d{8,15}$/.test(phone)) return { ok: false, reason: 'invalid phone number' };
    await this.page.load(`https://web.whatsapp.com/send?phone=${phone}`);
    for (let i = 0; i < 60; i++) {
      throwIfAborted(signal);
      if (await call<boolean>(this.page, 'invalidNumber()')) return { ok: false, reason: 'this number is not on WhatsApp' };
      if (await call<boolean>(this.page, 'hasComposer()')) {
        return { ok: true, chatTitle: (await call<string | null>(this.page, 'chatTitle()')) ?? undefined };
      }
      if ((await call<WaStatus>(this.page, 'status()')) === 'qr_required') return { ok: false, reason: 'WhatsApp is not linked (QR code)' };
      await sleep(500, signal);
    }
    return { ok: false, reason: 'the chat did not open in time' };
  }

  async setDraft(text: string, signal?: AbortSignal) {
    if (!(await call<boolean>(this.page, 'focusComposer()'))) return { ok: false, observed: '' };
    await call(this.page, 'clearComposer()');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) await this.page.insertText(lines[i]!);
      if (i < lines.length - 1) await this.page.pressKey('Shift+Enter');
    }
    await sleep(150, signal);
    let observed = (await call<string | null>(this.page, 'composerText()')) ?? '';
    if (norm(observed) !== norm(text)) {
      // fallback input path
      await call(this.page, 'clearComposer()');
      await call(this.page, `insertViaExec(${JSON.stringify(text)})`);
      await sleep(150, signal);
      observed = (await call<string | null>(this.page, 'composerText()')) ?? '';
    }
    return { ok: true, observed };
  }

  async clickSend(signal?: AbortSignal) {
    const t = this.now();
    this.sentTimes = this.sentTimes.filter((x) => t - x < 3_600_000);
    const last = this.sentTimes.at(-1);
    if (last !== undefined && t - last < this.limits.minGapMs) await sleep(this.limits.minGapMs - (t - last), signal);
    if (this.sentTimes.length >= this.limits.perHour) return { ok: false };
    const rows = await call<Array<{ id: string }>>(this.page, 'outgoing()');
    this.preSendIds = new Set(rows.map((r) => r.id));
    const clicked = await call<boolean>(this.page, 'clickSendButton()');
    if (!clicked) await this.page.pressKey('Enter');
    this.sentTimes.push(this.now());
    return { ok: true };
  }

  async findOutgoing(text: string, _since: number, signal?: AbortSignal): Promise<{ found: boolean; delivery: WaDelivery }> {
    throwIfAborted(signal);
    const rows = await call<Array<{ id: string; text: string; status: WaDelivery }>>(this.page, 'outgoing()');
    const want = norm(text);
    const hit = [...rows].reverse().find((r) => !this.preSendIds.has(r.id) && norm(r.text) === want);
    return hit ? { found: true, delivery: hit.status } : { found: false, delivery: 'unknown' };
  }
}
