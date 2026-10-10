import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { WhatsAppDesktop } from '../src/main/whatsapp/desktop';
import { type PageDriver, WhatsAppWeb } from '../src/main/whatsapp/web';
import { makeRig } from './helpers';

const row = (id: string, text: string, label: string, icon = 'msg-check') =>
  `<div data-id="${id}"><span class="selectable-text">${text}</span><span data-icon="${icon}" aria-label=" ${label} "></span></div>`;

/** A mock WhatsApp Web DOM + trusted-input emulation. Verifies OUR script/controller logic only, not the live site. */
class DomDriver implements PageDriver {
  dom!: JSDOM;
  url = '';
  loaded: string[] = [];
  constructor(private html: (url: string) => string, public onSend?: (text: string, d: DomDriver) => void) {}
  private mount(url: string) {
    this.url = url;
    this.dom = new JSDOM(this.html(url), { runScripts: 'outside-only', url: 'https://web.whatsapp.com/' });
    const doc = this.dom.window.document as Document & { execCommand?: unknown };
    (doc as unknown as { execCommand: (c: string, ui: boolean, v: string) => boolean }).execCommand = (cmd, _ui, val) => {
      const c = doc.querySelector('footer [contenteditable="true"]') as HTMLElement | null;
      if (!c) return false;
      if (cmd === 'insertText') c.textContent = (c.textContent ?? '') + val;
      if (cmd === 'delete') c.textContent = '';
      return true;
    };
  }
  async load(url: string) { this.loaded.push(url); this.mount(url); }
  currentUrl() { return this.url; }
  async eval<T>(js: string): Promise<T> { if (!this.dom) this.mount(this.url || 'https://web.whatsapp.com/'); return this.dom.window.eval(js) as T; }
  async insertText(text: string) { const c = this.dom.window.document.querySelector('footer [contenteditable="true"]')!; c.textContent = (c.textContent ?? '') + text; }
  async pressKey(key: string) {
    const d = this.dom.window.document;
    if (key === 'Enter') this.send();
    if (key === 'Shift+Enter') { const c = d.querySelector('footer [contenteditable="true"]')!; c.textContent += '\n'; }
  }
  send() {
    const d = this.dom.window.document;
    const c = d.querySelector('footer [contenteditable="true"]')!;
    const text = c.textContent ?? '';
    const n = d.querySelectorAll('[data-id^="true_"]').length;
    d.querySelector('#main')!.insertAdjacentHTML('beforeend', row(`true_${n + 1}`, text, 'Sent'));
    c.textContent = '';
    this.onSend?.(text, this);
  }
  async show() { /* */ }
}
const chatHtml = (extra = '') => `<div id="pane-side"></div><div id="main">${extra}<footer><div contenteditable="true" role="textbox"></div><button aria-label="Send"></button></footer></div>`;
const wire = (d: DomDriver) => {
  const btn = d.dom.window.document.querySelector('footer button')!;
  btn.addEventListener('click', () => d.send());
};

describe('WhatsApp Web controller (mock DOM)', () => {
  it('status: ready / QR / loading', async () => {
    const mk = (html: string) => new WhatsAppWeb(new DomDriver(() => html));
    expect(await mk('<div id="pane-side"></div>').status()).toBe('ready');
    expect(await mk('<canvas aria-label="Scan this QR code to link a device!"></canvas>').status()).toBe('qr_required');
  }, 30_000);
  it('opens a chat by phone number and detects an invalid number', async () => {
    const d = new DomDriver(() => chatHtml());
    expect(await new WhatsAppWeb(d).openChat('252611111111')).toMatchObject({ ok: true });
    expect(d.loaded).toEqual(['https://web.whatsapp.com/send?phone=252611111111']);
    const bad = new WhatsAppWeb(new DomDriver(() => '<body>Phone number shared via url is invalid.</body>'));
    expect(await bad.openChat('252600000000')).toMatchObject({ ok: false, reason: expect.stringContaining('not on WhatsApp') });
    expect(await bad.openChat('abc')).toMatchObject({ ok: false });
  });
  it('types the draft, reads it back, and does NOT send', async () => {
    const d = new DomDriver(() => chatHtml());
    const w = new WhatsAppWeb(d);
    await w.openChat('252611111111');
    const r = await w.setDraft('Si degdeg ah ii soo wac.');
    expect(r).toEqual({ ok: true, observed: 'Si degdeg ah ii soo wac.' });
    expect(d.dom.window.document.querySelectorAll('[data-id^="true_"]').length).toBe(0);
  });
  it('multi-line drafts use Shift+Enter, not Enter', async () => {
    const d = new DomDriver(() => chatHtml());
    const w = new WhatsAppWeb(d);
    await w.openChat('252611111111');
    const r = await w.setDraft('Salaan\nSi degdeg ah');
    expect(r.observed).toBe('Salaan\nSi degdeg ah');
    expect(d.dom.window.document.querySelectorAll('[data-id^="true_"]').length).toBe(0);
  });
  it('sends and finds the NEW outgoing bubble, ignoring older identical messages; reads status from the page', async () => {
    const d = new DomDriver(() => chatHtml(row('true_old', 'Si degdeg ah ii soo wac.', 'Read', 'msg-dblcheck')));
    const w = new WhatsAppWeb(d, Date.now, { minGapMs: 0, perHour: 20 });
    await w.openChat('252611111111');
    wire(d);
    await w.setDraft('Si degdeg ah ii soo wac.');
    expect((await w.findOutgoing('Si degdeg ah ii soo wac.', 0)).found).toBe(true); // the OLD one is visible before sending...
    await w.clickSend();
    const res = await w.findOutgoing('Si degdeg ah ii soo wac.', 0);
    expect(res).toEqual({ found: true, delivery: 'sent' }); // ...but after sending only the new "Sent" bubble counts
  });
  it('does not report a send that never appeared', async () => {
    const d = new DomDriver(() => chatHtml());
    const w = new WhatsAppWeb(d, Date.now, { minGapMs: 0, perHour: 20 });
    await w.openChat('252611111111');
    expect(await w.findOutgoing('nothing', 0)).toEqual({ found: false, delivery: 'unknown' });
  });
  it('maps delivery states from labels and from icon names', async () => {
    const html = chatHtml(row('true_1', 'a', 'Pending', 'msg-time') + row('true_2', 'b', 'Delivered', 'msg-dblcheck') + row('true_3', 'c', 'Read', 'msg-dblcheck') + `<div data-id="true_4"><span class="selectable-text">d</span><span data-icon="msg-dblcheck-ack"></span></div>`);
    const w = new WhatsAppWeb(new DomDriver(() => html));
    await w.openChat('252611111111');
    const out = (await (w as unknown as { page: DomDriver }).page.eval<Array<{ text: string; status: string }>>('window.__afu.outgoing()'));
    expect(out.map((o) => `${o.text}:${o.status}`)).toEqual(['a:pending', 'b:delivered', 'c:read', 'd:read']);
  });
  it('enforces a send-rate limit', async () => {
    const d = new DomDriver(() => chatHtml());
    const w = new WhatsAppWeb(d, Date.now, { minGapMs: 0, perHour: 2 });
    await w.openChat('252611111111');
    wire(d);
    expect((await w.clickSend()).ok).toBe(true);
    expect((await w.clickSend()).ok).toBe(true);
    expect((await w.clickSend()).ok).toBe(false);
  });
});

describe('WhatsApp Desktop mode is honest about its limits', () => {
  it('prefills but never sends, and the tools say so', async () => {
    const opened: string[] = [];
    const rig = await makeRig();
    rig.services.whatsapp = new WhatsAppDesktop(async (u) => { opened.push(u); }, async () => true);
    await rig.a.handle('Hooyo u qor Waan imaanayaa, ha dirin', { source: 'text' });
    expect(opened).toEqual(['whatsapp://send?phone=252633333333&text=Waan%20imaanayaa']);
    expect(rig.speech.spoken[0]).toContain('ma xaqiijin karo');
    await rig.a.handle('Hooyo u dir Waan imaanayaa', { source: 'text' });
    expect(rig.speech.spoken.at(-1)).toContain('Desktop');
    expect(opened).toHaveLength(1);
  });
});
