/**
 * Script injected into web.whatsapp.com. It only READS the page and focuses the message box; sending is performed
 * by the controller with trusted input events. WhatsApp changes its markup from time to time, so every lookup has
 * fallbacks and the controller reports "could not read" instead of guessing.
 * THESE SELECTORS ARE NOT VERIFIED AGAINST THE LIVE SITE IN THIS REPOSITORY'S TESTS (see docs/LIMITATIONS.md).
 */
export const WA_PAGE_SCRIPT = String.raw`
(() => {
  if (window.__afu) return;
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.from((r || document).querySelectorAll(s));
  const composer = () =>
    q('footer [contenteditable="true"][role="textbox"]') ||
    q('footer div[contenteditable="true"]') ||
    q('div[contenteditable="true"][data-tab="10"]');
  const norm = (s) => (s || '').replace(/‎|‏/g, '').replace(/\s+/g, ' ').trim();
  const statusOf = (row) => {
    const icon = q('[data-icon^="msg-"]', row);
    if (!icon) return 'unknown';
    const label = norm(icon.getAttribute('aria-label')).toLowerCase();
    if (label === 'read') return 'read';
    if (label === 'delivered') return 'delivered';
    if (label === 'sent') return 'sent';
    if (label === 'pending') return 'pending';
    const d = icon.getAttribute('data-icon');
    if (d === 'msg-time') return 'pending';
    if (d === 'msg-check') return 'sent';
    if (d === 'msg-dblcheck') return 'delivered';
    if (d === 'msg-dblcheck-ack') return 'read';
    return 'unknown';
  };
  window.__afu = {
    status() {
      if (q('#pane-side')) return 'ready';
      if (q('canvas[aria-label*="QR" i]') || q('[data-ref]') || q('[data-testid="qrcode"]')) return 'qr_required';
      return 'loading';
    },
    invalidNumber() {
      const t = norm(document.body.innerText || document.body.textContent).toLowerCase();
      return t.includes('phone number shared via url is invalid') || t.includes('isn’t on whatsapp') || t.includes("isn't on whatsapp");
    },
    hasComposer() { return !!composer(); },
    focusComposer() { const c = composer(); if (!c) return false; c.focus(); return document.activeElement === c; },
    composerText() { const c = composer(); return c ? (c.innerText || c.textContent || '').replace(/\n$/, '') : null; },
    clearComposer() {
      const c = composer(); if (!c) return false; c.focus();
      document.execCommand('selectAll', false, null); document.execCommand('delete', false, null); return true;
    },
    insertViaExec(text) { const c = composer(); if (!c) return false; c.focus(); return document.execCommand('insertText', false, text); },
    clickSendButton() {
      const b = q('footer button[aria-label="Send" i]') || (q('footer [data-icon="send"]') || {}).closest?.('button');
      if (!b) return false; b.click(); return true;
    },
    outgoing() {
      return qa('[data-id^="true_"]').slice(-15).map((row) => {
        const parts = qa('span.selectable-text, [data-testid="msg-text"]', row).map((e) => e.innerText || e.textContent || '');
        return { id: row.getAttribute('data-id'), text: norm(parts.join(' ')), status: statusOf(row) };
      });
    },
    chatTitle() { const h = q('header span[title]'); return h ? h.getAttribute('title') : null; },
  };
})();
`;
