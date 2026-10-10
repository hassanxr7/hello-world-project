import type { WaStatus, WhatsAppController } from '../../core/platform';

/**
 * WhatsApp Desktop through its documented `whatsapp://send?phone=&text=` link. This can open a chat and PRE-FILL text,
 * but Windows offers no reliable way to read the composer or the chat, or to confirm a send. So this mode never sends.
 */
export class WhatsAppDesktop implements WhatsAppController {
  readonly caps = { verifyComposer: false, canSend: false, verifyDelivery: false };
  private phone = '';
  constructor(
    private openExternal: (url: string) => Promise<void>,
    private appPresent: () => Promise<boolean>,
  ) {}
  async status(): Promise<WaStatus> {
    return (await this.appPresent()) ? 'ready' : 'unavailable';
  }
  async show() {
    await this.openExternal('whatsapp://');
  }
  async openChat(phone: string) {
    if (!/^\d{8,15}$/.test(phone)) return { ok: false, reason: 'invalid phone number' };
    this.phone = phone;
    return { ok: true };
  }
  async setDraft(text: string) {
    await this.openExternal(`whatsapp://send?phone=${this.phone}&text=${encodeURIComponent(text)}`);
    return { ok: true, observed: '' };
  }
  async clickSend() {
    return { ok: false };
  }
  async findOutgoing() {
    return { found: false, delivery: 'unknown' as const };
  }
}
