import { z, ok, unverified, failed, needsInput, type ToolDef } from './framework';
import type { Services } from './services';
import { sleep, throwIfAborted } from '../util';
import type { Contact } from '../../shared/types';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

export function makeWhatsAppTools(s: Services, getContact: (id: string) => Contact | undefined): ToolDef<any>[] {
  const tools: ToolDef<any>[] = [];

  async function prepare(contact: Contact, message: string, signal: AbortSignal) {
    const status = await s.whatsapp.status(signal);
    if (status === 'unavailable') return { err: failed('WhatsApp lama heli karo.', 'WhatsApp is not available.') };
    if (status === 'qr_required') {
      await s.whatsapp.show();
      return { err: needsInput('WhatsApp wali lama xirin. Fadlan QR-ka scan garee telefoonkaaga, kadibna ii sheeg mar kale.', 'WhatsApp Web is not linked yet. Scan the QR code with your phone, then ask again.') };
    }
    if (status === 'loading') return { err: failed('WhatsApp wali wuu soo dhacayaa; isku day markale.', 'WhatsApp is still loading; try again.') };
    const chat = await s.whatsapp.openChat(contact.phone, signal);
    if (!chat.ok) return { err: failed(`Ma furi karo wada-hadalka ${contact.displayName}.`, `Could not open the chat with ${contact.displayName}: ${chat.reason ?? 'unknown'}`) };
    const draft = await s.whatsapp.setDraft(message, signal);
    if (!draft.ok) return { err: failed('Qoraalka sanduuqa ma gelin; ma dirin.', 'Could not put the text in the message box. Nothing was sent.') };
    if (s.whatsapp.caps.verifyComposer && norm(draft.observed) !== norm(message)) {
      return { err: failed('Qoraalka sanduuqa ma gelin si sax ah; ma dirin.', `The composer text did not match the message (saw: "${draft.observed.slice(0, 80)}"). Nothing was sent.`) };
    }
    return { chat };
  }

  const commonSchema = z.object({ contactId: z.string().min(1), message: z.string().min(1).max(4000) });

  tools.push({
    meta: { name: 'whatsapp.prepare', risk: 'messaging', readOnly: false, permissionKey: 'messaging.draft' },
    description: 'Open the WhatsApp chat with an approved contact and put the message in the box WITHOUT sending it.',
    schema: commonSchema,
    describe: (i: { contactId: string }) => `Prepare WhatsApp message for ${getContact(i.contactId)?.displayName ?? i.contactId}`,
    timeoutMs: 45_000,
    async run(input: { contactId: string; message: string }, rt) {
      const c = getContact(input.contactId);
      if (!c || !c.approved) return failed('Qofkaas ma ahan xiriir la oggolaaday.', 'Recipient is not an approved contact.');
      const r = await prepare(c, input.message, rt.signal);
      if (r.err) return r.err;
      if (!s.whatsapp.caps.verifyComposer) {
        return unverified(
          `Waxaan u furay wada-hadalka ${c.displayName} oo fariinta ayaan ku soo gelinayay, laakiin ma xaqiijin karo qoraalka; hubi ka hor intaadan dirin. Lama dirin.`,
          `Opened the chat with ${c.displayName} with the text pre-filled through WhatsApp Desktop's link. The text could not be verified and it has NOT been sent.`,
          'desktop deep link: composer unreadable',
        );
      }
      return ok(`Fariinta ${c.displayName} waan u diyaariyay, mana dirin.`, `Message for ${c.displayName} is typed in the box. It has NOT been sent.`, 'composer-read-back', input.message);
    },
  });

  tools.push({
    meta: { name: 'whatsapp.send', risk: 'messaging', readOnly: false, permissionKey: 'messaging.send' },
    description: 'Send a WhatsApp message to an approved contact and verify it appears as sent.',
    schema: commonSchema.extend({ explicitSend: z.boolean().default(false), allowDuplicate: z.boolean().default(false) }),
    describe: (i: { contactId: string }) => `Send WhatsApp message to ${getContact(i.contactId)?.displayName ?? i.contactId}`,
    facts: (i: { contactId: string; explicitSend: boolean }) => ({
      explicitSend: i.explicitSend,
      contactId: i.contactId,
      contactFastSend: getContact(i.contactId)?.fastSend ?? false,
    }),
    timeoutMs: 60_000,
    async run(input: { contactId: string; message: string; allowDuplicate: boolean }, rt) {
      const c = getContact(input.contactId);
      if (!c || !c.approved) return failed('Qofkaas ma ahan xiriir la oggolaaday; ma dirin.', 'Recipient is not an approved contact. Nothing was sent.');
      const last = s.state.lastSent;
      if (!input.allowDuplicate && last && last.phone === c.phone && last.text === input.message && Date.now() - last.at < 60_000) {
        return needsInput('Fariintan hadda ayaan u dirnay. Ma mar kale dirayaa?', 'The same message was sent to this contact less than a minute ago. Send again?', { duplicate: true });
      }
      if (!s.whatsapp.caps.canSend) {
        return failed(
          'WhatsApp Desktop ma xaqiijin karo dirista; isticmaal WhatsApp Web ama riix Enter adigu.',
          'WhatsApp Desktop mode can prefill but cannot send or verify. Use WhatsApp Web mode, or press Enter yourself. Nothing was sent.',
        );
      }
      const prep = await prepare(c, input.message, rt.signal);
      if (prep.err) return prep.err;
      throwIfAborted(rt.signal); // a stop/cancel that arrived while the message was being typed must prevent the send
      const t0 = Date.now();
      rt.progress('Sending');
      const click = await s.whatsapp.clickSend(rt.signal);
      if (!click.ok) return failed('Badhanka dirista ma riixin; fariinta lama dirin.', 'Could not trigger the send action; the message may still be in the box.');
      s.state.lastSent = { phone: c.phone, text: input.message, at: t0 };

      // Verify: poll the chat for the outgoing bubble.
      let seen: { found: boolean; delivery: string } = { found: false, delivery: 'unknown' };
      for (let i = 0; i < 12; i++) {
        seen = await s.whatsapp.findOutgoing(input.message, t0 - 3000, rt.signal);
        if (seen.found && seen.delivery !== 'pending') break;
        await sleep(700, rt.signal);
      }
      if (!s.whatsapp.caps.verifyDelivery) {
        return unverified('Waan riixay dirista, laakiin ma xaqiijin karo.', 'Send was triggered; delivery cannot be verified in this mode.', 'no chat access');
      }
      if (!seen.found) {
        return unverified(
          `Waan riixay dirista ${c.displayName}, laakiin ma arko fariinta wada-hadalka. Fadlan hubi gacanta.`,
          'Send was triggered, but the message was not found in the chat. Please check WhatsApp manually.',
          'outgoing message not observed',
        );
      }
      switch (seen.delivery) {
        case 'read':
          return ok(`Fariinta ${c.displayName} waa la diray oo waa la akhriyay.`, `Sent to ${c.displayName}; WhatsApp shows it as read.`, 'whatsapp-ui-status', 'read');
        case 'delivered':
          return ok(`Fariinta ${c.displayName} waa la diray oo waa la gaarsiiyay.`, `Sent to ${c.displayName}; delivered to their device.`, 'whatsapp-ui-status', 'delivered');
        case 'sent':
          return ok(`Fariinta ${c.displayName} waa la diray (serverka WhatsApp ayaa helay). Wali lama xaqiijin inay gaartay.`, `Sent to ${c.displayName}; accepted by WhatsApp. Delivery is not confirmed yet.`, 'whatsapp-ui-status', 'sent');
        case 'pending':
          return unverified(`Fariinta waa ku jirtaa wada-hadalka, laakiin wali waa sugaysaa internetka (saacad).`, 'The message is in the chat but still pending (clock icon); it has not reached WhatsApp servers yet.', 'status pending');
        default:
          return unverified(`Fariinta waxay ka muuqataa wada-hadalka, laakiin xaaladeeda ma aqrin karo.`, 'The message appears in the chat but its delivery state could not be read.', 'status unknown');
      }
    },
  });

  tools.push({
    meta: { name: 'whatsapp.open', risk: 'routine', readOnly: false, permissionKey: 'whatsapp.open' },
    description: 'Open WhatsApp and report whether it is signed in.',
    schema: z.object({}),
    describe: () => 'Open WhatsApp',
    async run(_i, rt) {
      await s.whatsapp.show();
      const st = await s.whatsapp.status(rt.signal);
      if (st === 'ready') return ok('WhatsApp waa furan yahay oo waa diyaar.', 'WhatsApp is open and signed in.', 'dom-state', 'chat list present');
      if (st === 'qr_required') return needsInput('WhatsApp waa furan yahay laakiin QR-ka scan garee si aad ugu xirto.', 'WhatsApp is open but needs the QR code scanned.');
      if (st === 'loading') return unverified('WhatsApp wali wuu soo dhacayaa.', 'WhatsApp is still loading.', 'loading');
      return failed('WhatsApp lama heli karo.', 'WhatsApp could not be opened.');
    },
  });

  return tools;
}
