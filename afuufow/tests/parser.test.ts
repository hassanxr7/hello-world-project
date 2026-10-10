import { describe, expect, it } from 'vitest';
import { parseCommand, type ParseContext } from '../src/core/nlu/parser';

const ctx = (o: Partial<ParseContext> = {}): ParseContext => ({ wakeNames: ['afuufow', 'afufo'], hasPendingMessage: false, ...o });
const p = (t: string, c?: Partial<ParseContext>) => parseCommand(t, ctx(c)).intent;

describe('stop words interrupt', () => {
  for (const w of ['Jooji', 'Jooji.', 'Sug', 'Aamus', 'Afuufow, jooji', 'jooji hadda']) {
    it(`"${w}" is a stop`, () => expect(p(w)).toMatchObject({ type: 'stop', scope: 'auto' }));
  }
  it('"Jooji muuqaalka" stops media', () => expect(p('Jooji muuqaalka.')).toEqual({ type: 'stop', scope: 'media' }));
  it('a stop word inside a dictated message is not a stop', () => {
    const i = p('Ahmed u qor jooji gaadhiga');
    expect(i.type).toBe('whatsapp_message');
  });
  it('"codka aamus" mutes volume rather than stopping speech', () => expect(p('aamus codka')).toEqual({ type: 'volume', action: 'mute' }));
});

describe('sit', () => {
  it('Fariiso', () => expect(p('Fariiso.')).toEqual({ type: 'greet_sit' }));
});

describe('applications / folders / sites', () => {
  it('Chrome fur', () => expect(p('Afuufow, Chrome fur')).toEqual({ type: 'open_app', app: 'Chrome' }));
  it('open chrome', () => expect(p('open chrome')).toEqual({ type: 'open_app', app: 'chrome' }));
  it('Downloads-ka fur', () => expect(p('Downloads-ka fur')).toEqual({ type: 'open_folder', folder: 'downloads' }));
  it('Dukumiintiyada fur', () => expect(p('Dukumiintiyada fur')).toEqual({ type: 'open_folder', folder: 'documents' }));
  it('YouTube fur', () => expect(p('YouTube fur')).toEqual({ type: 'open_url', target: 'https://www.youtube.com' }));
  it('WhatsApp-ka fur', () => expect(p('WhatsApp-ka fur')).toEqual({ type: 'open_whatsapp' }));
  it('Visual Studio Code fur', () => expect(p('Visual Studio Code fur')).toEqual({ type: 'open_app', app: 'Visual Studio Code' }));
});

describe('search and files', () => {
  it('Ii raadi file-ka invoice-ka', () => expect(p('Ii raadi file-ka invoice-ka')).toEqual({ type: 'find_file', query: 'invoice' }));
  it('google search', () => expect(p('search google for python tutorials')).toMatchObject({ type: 'web_search', query: 'python tutorials' }));
  it('Somali web search', () => expect(p('Google-ka ka raadi cimilada Muqdisho')).toMatchObject({ type: 'web_search', query: 'cimilada Muqdisho' }));
});

describe('YouTube', () => {
  it('song', () => {
    const i = p('Afuufow, gal YouTube oo ii shid heesta Waar Waar Waar');
    expect(i).toMatchObject({ type: 'youtube_play', kind: 'song', query: 'Waar Waar Waar' });
  });
  it('video about topic', () => {
    expect(p('Ii shid muuqaal ku saabsan barashada Python')).toMatchObject({ type: 'youtube_play', kind: 'video', query: 'barashada Python' });
  });
  it('Jooji muuqaalka', () => expect(p('Jooji muuqaalka')).toEqual({ type: 'stop', scope: 'media' }));
  it('Sii wad', () => expect(p('Sii wad')).toEqual({ type: 'media_control', action: 'resume' }));
  it('English play', () => expect(p('play Believer')).toMatchObject({ type: 'youtube_play', query: 'Believer' }));
});

describe('volume', () => {
  it('Codka hoos u dhig', () => expect(p('Codka hoos u dhig')).toMatchObject({ type: 'volume', action: 'down' }));
  it('Codka kor u qaad', () => expect(p('Codka kor u qaad')).toMatchObject({ type: 'volume', action: 'up' }));
  it('Codka u dhig 40', () => expect(p('Codka u dhig 40')).toEqual({ type: 'volume', action: 'set', amount: 40 }));
  it('Codka u dhig konton', () => expect(p('codka u dhig konton')).toEqual({ type: 'volume', action: 'set', amount: 50 }));
});

describe('screen', () => {
  it('screenshot', () => expect(p('Screenshot qaad')).toEqual({ type: 'screenshot' }));
  it('sawir qaad', () => expect(p('sawir qaad')).toEqual({ type: 'screenshot' }));
  it('read screen', () => expect(p('Shaashadda akhri')).toMatchObject({ type: 'read_screen' }));
});

describe('drafting', () => {
  it('Ii qor email English ah', () => expect(p('Ii qor email English ah')).toMatchObject({ type: 'draft_text', kind: 'email', language: 'en' }));
  it('with topic', () => {
    const i = p('Ii qor email English ah oo ku saabsan kulanka berri');
    expect(i).toMatchObject({ type: 'draft_text', kind: 'email', language: 'en' });
  });
});

describe('messaging', () => {
  it('open WhatsApp then write (unspecified, exact quoted text)', () => {
    const i = p('Afuufow, WhatsApp-ka fur, Ahmed u qor: ‘Si degdeg ah ii soo wac.’');
    expect(i).toEqual({ type: 'whatsapp_message', contact: 'Ahmed', message: 'Si degdeg ah ii soo wac.', mode: 'unspecified', openFirst: true });
  });
  it('no quotes (as from speech)', () => {
    const i = p('WhatsApp-ka fur Ahmed u qor Si degdeg ah ii soo wac');
    expect(i).toMatchObject({ type: 'whatsapp_message', contact: 'Ahmed', message: 'Si degdeg ah ii soo wac', mode: 'unspecified', openFirst: true });
  });
  it('explicit send', () => {
    expect(p('Ahmed u dir fariintan: ‘Si degdeg ah ii soo wac.’')).toEqual({
      type: 'whatsapp_message', contact: 'Ahmed', message: 'Si degdeg ah ii soo wac.', mode: 'send', openFirst: false,
    });
  });
  it('two-word contact', () => {
    expect(p('Ahmed Ali u dir fariintan Waan soo daahay')).toMatchObject({ contact: 'Ahmed Ali', message: 'Waan soo daahay', mode: 'send' });
  });
  it('draft: ha dirin', () => {
    expect(p('Ahmed u qor Si degdeg ah ii soo wac, ha dirin')).toMatchObject({ mode: 'draft', message: 'Si degdeg ah ii soo wac' });
  });
  it('draft: ha dirin after quoted text', () => {
    expect(p('Ahmed u qor “Waan imaanayaa” ha dirin')).toMatchObject({ mode: 'draft', message: 'Waan imaanayaa' });
  });
  it('read back before sending', () => {
    expect(p('Ahmed u dir Waan imaanayaa, ii akhri ka hor intaadan dirin')).toMatchObject({ mode: 'read_back', message: 'Waan imaanayaa' });
  });
  it('message text is preserved exactly, including hyphen words and punctuation', () => {
    expect(p('Ahmed u dir fariintan: “Laptop-ka ayaan furay, sug 5 daqiiqo!”')).toMatchObject({ message: 'Laptop-ka ayaan furay, sug 5 daqiiqo!' });
  });
  it('follow-ups require a pending message', () => {
    expect(p('Fariinta diyaari, ha dirin').type).not.toBe('message_followup');
    expect(p('Fariinta diyaari, ha dirin', { hasPendingMessage: true })).toEqual({ type: 'message_followup', action: 'draft_pending' });
    expect(p('Fariinta ii akhri', { hasPendingMessage: true })).toEqual({ type: 'message_followup', action: 'read_pending' });
    expect(p('Dir', { hasPendingMessage: true })).toEqual({ type: 'message_followup', action: 'send_pending' });
  });
  it('English', () => {
    expect(p('send Ahmed a message: call me now')).toMatchObject({ type: 'whatsapp_message', contact: 'Ahmed', message: 'call me now', mode: 'send' });
  });
});

describe('fallthrough', () => {
  it('chat questions go to the AI', () => {
    const r = parseCommand('Maxaa yahay caasimadda Kenya?', ctx());
    expect(r.intent.type).toBe('chat');
    expect(r.rule).toBe(false);
  });
});
