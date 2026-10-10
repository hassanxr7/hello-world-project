import type { Intent, MsgMode, ParseResult } from './intents';
import { type Tok, has, indexOfAnySeq, indexOfSeq, slice, stripQuotes, tokenize } from './tokens';
import { normalizeText } from '../memory/names';

export interface ParseContext {
  /** wake word + learned aliases, stripped when they start the utterance */
  wakeNames: string[];
  /** a drafted/awaiting message exists (enables "dir" / "ha dirin" follow-ups) */
  hasPendingMessage: boolean;
  /** extra folder aliases (label -> aliases) from the owner's approved folders */
  folderAliases?: Record<string, string[]>;
}

export const DEFAULT_CTX: ParseContext = { wakeNames: ['afuufow'], hasPendingMessage: false };

const BUILTIN_FOLDERS: Record<string, string[]> = {
  downloads: ['downloads', 'download', 'soo dejisyada', 'soo degsimaha'],
  documents: ['documents', 'document', 'docs', 'dukumiinti', 'dukumiintiyada', 'dukumentiyada', 'dukumentiga'],
  desktop: ['desktop', 'desktopka'],
  pictures: ['pictures', 'photos', 'sawirrada', 'sawiro'],
  music: ['music', 'muusiga', 'muusik'],
  videos: ['videos', 'muuqaalada', 'fiidiyowyada'],
};

const SITES: Record<string, string> = {
  youtube: 'https://www.youtube.com',
  yutuub: 'https://www.youtube.com',
  gmail: 'https://mail.google.com',
  google: 'https://www.google.com',
  facebook: 'https://www.facebook.com',
  twitter: 'https://x.com',
  github: 'https://github.com',
  maps: 'https://maps.google.com',
};

const OPEN_VERBS = new Set(['fur', 'furo', 'bilow', 'billow', 'open', 'launch', 'start', 'run', 'shid']);
const NOISE = new Set(['fadlan', 'boss', 'hadda', 'iga', 'ii', 'oo', 'iyo', 'please', 'now', 'kan', 'kaas', 'the', 'a', 'an', 'my']);
const ARTICLES = new Set(['ka', 'ga', 'ta', 'da', 'ha', 'kii', 'tii', 'kaas', 'taas']);

const SOMALI_NUMBERS: Record<string, number> = {
  eber: 0, kow: 1, labo: 2, saddex: 3, afar: 4, shan: 5, lix: 6, todobo: 7, siddeed: 8, sagaal: 9, toban: 10,
  labaatan: 20, soddon: 30, afartan: 40, konton: 50, lixdan: 60, todobaatan: 70, siddeetan: 80, sagaashan: 90, boqol: 100,
};

const YES = new Set(['haa', 'haye', 'haa', 'ok', 'okay', 'sax', 'hubaal', 'yes', 'yeah', 'waa', 'dir', 'ha', 'haaye']);
const NO = new Set(['maya', 'no', 'nope', 'ha']);

function stripWake(toks: Tok[], wake: string[]): Tok[] {
  const w = wake.map((x) => normalizeText(x));
  let i = 0;
  while (i < toks.length && (w.includes(toks[i]!.n) || toks[i]!.n === 'boss')) i++;
  return toks.slice(i);
}

function parseNumber(toks: Tok[]): number | undefined {
  for (const t of toks) {
    if (/^\d{1,3}$/.test(t.n)) return Math.min(100, parseInt(t.n, 10));
    if (t.n in SOMALI_NUMBERS) return SOMALI_NUMBERS[t.n];
  }
  // "soddon iyo shan" style compound (tens + units)
  const idx = toks.findIndex((t) => t.n in SOMALI_NUMBERS && SOMALI_NUMBERS[t.n]! >= 10);
  if (idx >= 0 && toks[idx + 1]?.n === 'iyo' && toks[idx + 2] && toks[idx + 2]!.n in SOMALI_NUMBERS) {
    return SOMALI_NUMBERS[toks[idx]!.n]! + SOMALI_NUMBERS[toks[idx + 2]!.n]!;
  }
  return undefined;
}

function detectLangWord(toks: Tok[]): 'en' | 'so' | 'ar' | null {
  for (const t of toks) {
    if (['english', 'ingiriis', 'ingiriisi', 'ingiriisiga', 'engelish', 'inglish'].includes(t.n)) return 'en';
    if (['soomaali', 'somali', 'soomaaliga'].includes(t.n)) return 'so';
    if (['carabi', 'arabic', 'carabiga'].includes(t.n)) return 'ar';
  }
  return null;
}

function cleanTarget(toks: Tok[]): string {
  return toks
    .filter((t) => !NOISE.has(t.n) && !OPEN_VERBS.has(t.n))
    .map((t) => t.raw.replace(/[,.;:!?]+$/g, ''))
    .join(' ')
    .trim();
}

function dropArticles(toks: Tok[]): Tok[] {
  return toks.filter((t) => !ARTICLES.has(t.n));
}

function endsClause(t: Tok): boolean {
  return /[,;:.!?]$/.test(t.raw);
}

/* ------------------------------------------------------------------ messaging */

const SEND_MARKERS = [
  ['u', 'dir'], ['u', 'soo', 'dir'], ['ugu', 'dir'], ['u', 'diraa'], ['u', 'dirto'], ['ugu', 'soo', 'dir'], ['u', 'diro'],
];
const WRITE_MARKERS = [['u', 'qor'], ['ugu', 'qor'], ['u', 'qora'], ['ugu', 'qora'], ['u', 'qoro']];
const DRAFT_MARKERS = [['u', 'diyaari'], ['ugu', 'diyaari'], ['u', 'diyaar', 'geli']];
const RECIPIENT_STOP = new Set([
  'fur', 'oo', 'iyo', 'ka', 'ga', 'whatsapp', 'whatsappka', 'wasaap', 'fadlan', 'boss', 'ii', 'hadda', 'haddana', 'kadibna', 'then', 'and',
]);
const MESSAGE_LEAD = new Set(['fariintan', 'fariinta', 'fariin', 'oo', 'leh', 'ah', 'qoraalkan', 'qoraalka', 'kan', 'sidan', 'sida', 'kuwan']);

function tailModifiers(tail: Tok[]): { cut: number; mode: MsgMode | null } {
  // returns index in tail where the message ends, and an explicit mode if a control phrase was found
  let cut = tail.length;
  let mode: MsgMode | null = null;
  const readIdx = Math.min(
    ...[indexOfSeq(tail, ['ii', 'akhri']), indexOfSeq(tail, ['ka', 'hor', 'intaadan']), indexOfSeq(tail, ['ka', 'hor', 'intaan'])]
      .filter((i) => i >= 0)
      .concat([Infinity]),
  );
  if (readIdx !== Infinity) {
    cut = readIdx;
    mode = 'read_back';
  }
  const draftIdx = indexOfAnySeq(tail, [['ha', 'dirin'], ['ha', 'u', 'dirin'], ['ha', 'dirina'], ['ha', 'u', 'dirina'], ['ha', 'diri'], ['dont', 'send'], ['do', 'not', 'send']]);
  if (draftIdx && draftIdx.i < cut) {
    cut = draftIdx.i;
    mode = 'draft';
  }
  const prep = indexOfAnySeq(tail, [['diyaari'], ['diyaar', 'u', 'dhig'], ['draft']]);
  if (prep && prep.i < cut && prep.i >= Math.max(1, tail.length - 3)) {
    cut = prep.i;
    mode = 'draft';
  }
  return { cut, mode };
}

function parseMessaging(text: string, toks: Tok[], ctx: ParseContext, body: string): ParseResult | null {
  const isWhatsApp = toks.some((t) => ['whatsapp', 'whatsappka', 'wasaap', 'watsap'].includes(t.n));

  // English forms: "send Ahmed a message: ..." / "message Ahmed ..." / "whatsapp Ahmed ..."
  const en = /^(?:please\s+)?(?:send|text|message|whatsapp|tell)\s+(?:a\s+(?:message|text)\s+to\s+)?([\p{L}][\p{L}'.]*(?:\s+[\p{L}][\p{L}'.]*)?)\s*(?:a\s+message|a\s+text)?\s*[:,]\s*(.+)$/isu.exec(body.trim());
  if (en && !/^(chrome|youtube|google)$/i.test(en[1]!)) {
    let msg = stripQuotes(en[2]!);
    const tt = tokenize(msg);
    const { cut, mode } = tailModifiers(tt);
    if (mode) msg = slice(msg, tt, 0, cut).replace(/[\s,]+$/, '');
    const verb = /^(?:please\s+)?(?:send|text)/i.test(body.trim()) ? 'send' : 'unspecified';
    return { intent: { type: 'whatsapp_message', contact: en[1]!.trim(), message: msg, mode: mode ?? verb, openFirst: false }, confidence: 0.8, rule: true };
  }

  const send = indexOfAnySeq(toks, SEND_MARKERS);
  const write = indexOfAnySeq(toks, WRITE_MARKERS);
  const prep = indexOfAnySeq(toks, DRAFT_MARKERS);
  const found = [
    send && { m: send, mode: 'send' as MsgMode },
    write && { m: write, mode: 'unspecified' as MsgMode },
    prep && { m: prep, mode: 'draft' as MsgMode },
  ]
    .filter(Boolean)
    .sort((a, b) => a!.m.i - b!.m.i)[0] as { m: { i: number; len: number }; mode: MsgMode } | undefined;

  if (!found) {
    // follow-ups on a pending message
    if (ctx.hasPendingMessage) {
      const n = toks.map((t) => t.n).join(' ');
      if (/^(fariinta )?(ii )?akhri/.test(n) || /^read( it| the message)?/.test(n)) return fu('read_pending');
      if (/^(ha dirin|ha u dirin|ha dirina|fariinta diyaari|diyaari|draft)/.test(n)) return fu('draft_pending');
      if (/^(tirtir|ilaali|cancel|jooji fariinta|ha dirin fariinta)/.test(n)) return fu('cancel_pending');
      if (/^(dir|u dir|haa dir|haa u dir|send|send it|dir fariinta|fariinta dir)$/.test(n)) return fu('send_pending');
    }
    if (isWhatsApp && toks.some((t) => OPEN_VERBS.has(t.n))) {
      return { intent: { type: 'open_whatsapp' }, confidence: 0.9, rule: true };
    }
    return null;
  }

  // recipient: tokens before the marker, within the same clause, stopping at noise
  const rec: Tok[] = [];
  for (let i = found.m.i - 1; i >= 0 && rec.length < 3; i--) {
    const t = toks[i]!;
    if (RECIPIENT_STOP.has(t.n)) break;
    if (i < found.m.i - 1 && endsClause(t)) break;
    rec.unshift(t);
  }
  // Also accept "fariin u diyaari Ahmed" style? Only the marker form is supported.
  const contact = rec.map((t) => t.raw.replace(/[,.;:!?]+$/g, '')).join(' ').trim();

  let tailStart = found.m.i + found.m.len;
  while (tailStart < toks.length && MESSAGE_LEAD.has(toks[tailStart]!.n) && tailStart < toks.length - 1) tailStart++;
  const tail = toks.slice(tailStart);
  let message = '';
  let mode: MsgMode = found.mode;
  const quoted = /[“"«‘]([^”"»’]+)[”"»’]/u.exec(text.slice(tail[0]?.start ?? text.length));
  if (quoted) {
    message = quoted[1]!.trim();
    const outside = text.slice((tail[0]?.start ?? 0) + (quoted.index ?? 0) + quoted[0].length);
    const mods = tailModifiers(tokenize(outside));
    if (mods.mode) mode = mods.mode;
    const before = tokenize(text.slice(tail[0]?.start ?? 0, (tail[0]?.start ?? 0) + (quoted.index ?? 0)));
    const m2 = tailModifiers(before);
    if (m2.mode) mode = m2.mode;
  } else {
    const { cut, mode: m } = tailModifiers(tail);
    if (m) mode = m;
    message = stripQuotes(slice(text, tail, 0, cut)).replace(/[\s,]+$/, '');
  }

  if (!contact) {
    return { intent: { type: 'whatsapp_message', contact: '', message, mode, openFirst: isWhatsApp }, confidence: 0.5, rule: true };
  }
  return {
    intent: { type: 'whatsapp_message', contact, message, mode, openFirst: isWhatsApp },
    confidence: message ? 0.9 : 0.6,
    rule: true,
  };

  function fu(action: 'draft_pending' | 'send_pending' | 'read_pending' | 'cancel_pending'): ParseResult {
    return { intent: { type: 'message_followup', action }, confidence: 0.85, rule: true };
  }
}

/* ------------------------------------------------------------------ main */

export function parseCommand(text: string, ctx: ParseContext = DEFAULT_CTX): ParseResult {
  const original = text.trim();
  const all = tokenize(original);
  const toks = stripWake(all, ctx.wakeNames);
  const body = toks.length ? original.slice(toks[0]!.start) : '';
  const words = toks.map((t) => t.n);
  const joined = words.join(' ');
  const R = (intent: Intent, confidence = 0.9): ParseResult => ({ intent, confidence, rule: true });

  if (toks.length === 0) return R({ type: 'chat', text: '' }, 0);

  // 1. Immediate stop commands: must be the first word (a stop word inside a dictated message is not a stop).
  const first = words[0]!;
  if (['jooji', 'joojin', 'sug', 'aamus', 'stop', 'wait', 'cancel', 'quiet', 'silence'].includes(first) || joined.startsWith('ha hadlin')) {
    const mediaTargets = ['muuqaalka', 'muuqaal', 'heesta', 'heeso', 'muusiga', 'muusigga', 'video', 'music', 'song', 'youtube', 'yutuub', 'fiidiyowga'];
    if (toks.length > 1 && toks.slice(1).some((t) => mediaTargets.includes(t.n))) return R({ type: 'stop', scope: 'media' }, 0.95);
    // "codka aamus" = mute volume, not "stop talking"
    if (first === 'aamus' && toks.length > 1 && has(toks, /^codka$/)) return R({ type: 'volume', action: 'mute' }, 0.9);
    if (toks.length <= 3) return R({ type: 'stop', scope: 'auto' }, 0.98);
  }
  if (joined === 'ha hadlin' || joined === 'ha hadlin hadda') return R({ type: 'stop', scope: 'auto' }, 0.98);

  // 2. Sit
  if (['fariiso', 'fadhiiso', 'fariisaw'].includes(first) && toks.length <= 3) return R({ type: 'greet_sit' }, 0.99);

  // 3. Language switch
  if (/ku hadal|speak|hadal/.test(joined) && detectLangWord(toks)) {
    const l = detectLangWord(toks);
    if (l === 'en' || l === 'so') return R({ type: 'set_language', language: l }, 0.85);
  }

  // 5. Messaging (WhatsApp)
  const msg = parseMessaging(original, toks, ctx, body);
  if (msg) return msg;

  // 4. Short yes/no answers (the orchestrator only honours them when something is pending)
  if (toks.length <= 3) {
    if (joined === 'ha dirin' || joined === 'ha u dirin') {
      return R(ctx.hasPendingMessage ? { type: 'message_followup', action: 'draft_pending' } : { type: 'confirm', yes: false }, 0.8);
    }
    if (toks.length === 1 || joined === 'haa dir' || joined === 'waa hagaag') {
      if (words.every((w) => YES.has(w)) && !(first === 'ha')) return R({ type: 'confirm', yes: true }, 0.7);
      if (words.every((w) => NO.has(w)) && first !== 'ha') return R({ type: 'confirm', yes: false }, 0.7);
    }
  }

  // 6. Continue / resume / media
  if (['sii wad', 'sii wado', 'ku soco', 'resume', 'continue', 'play'].includes(joined) || /^sii wad\b/.test(joined)) {
    return R({ type: 'media_control', action: 'resume' }, 0.9);
  }
  if (/^(pause|jooji muuqaalka)$/.test(joined)) return R({ type: 'media_control', action: 'pause' });
  if (/^(next|midda xigta|xigta|mid kale|skip)$/.test(joined)) return R({ type: 'media_control', action: 'next' }, 0.85);
  if (/^(previous|midda hore|dib u celi)$/.test(joined)) return R({ type: 'media_control', action: 'previous' }, 0.8);

  // 7. Volume
  if (has(toks, /^(codka|volume|sound)$/)) {
    const n = parseNumber(toks);
    if (words.includes('unmute') || joined.includes('codka celi') || joined.includes('codka fur')) return R({ type: 'volume', action: 'unmute' });
    if (words.includes('mute') || words.includes('aamus')) return R({ type: 'volume', action: 'mute' });
    if (n !== undefined && (words.includes('dhig') || words.includes('set') || words.includes('u'))) return R({ type: 'volume', action: 'set', amount: n });
    if (joined.includes('hoos') || words.includes('dhimi') || words.includes('yaree') || words.includes('down') || words.includes('lower')) {
      return R({ type: 'volume', action: 'down', amount: n });
    }
    if (joined.includes('kor') || words.includes('kordhi') || words.includes('up') || words.includes('raise') || words.includes('increase') || words.includes('badi')) {
      return R({ type: 'volume', action: 'up', amount: n });
    }
    if (n !== undefined) return R({ type: 'volume', action: 'set', amount: n }, 0.75);
  }

  // 8. Screenshot / screen reading
  if (/screenshot|screen shot/.test(joined) || (has(toks, /^sawir/) && has(toks, /^(qaad|qaado|qaata|take)$/)) || joined.includes('sawirka shaashadda')) {
    return R({ type: 'screenshot' }, 0.92);
  }
  if ((has(toks, /^shaashadda?$/) && has(toks, /^(akhri|akhriso|read)$/)) || /read (the )?screen/.test(joined) || joined.includes('maxaa shaashadda ku jira')) {
    return R({ type: 'read_screen' }, 0.88);
  }

  // 9. Visitor report
  if (/(booqda|booqdayaasha|yaa yimid|qof ma yimid|ma jiraa qof|visitor)/.test(joined) && /(sheeg|tus|diiwaan|report|show|jiraa|yimid)/.test(joined)) {
    return R({ type: 'visitor_report' }, 0.85);
  }

  // 10. Remember
  const rem = /^(?:xusuuso|xusuus|remember)\s*(?:in|that)?\s+(.+)$/isu.exec(body);
  if (rem) return R({ type: 'remember', text: rem[1]!.trim() }, 0.85);

  // 11. Drafting text for me
  if ((joined.startsWith('ii qor') || joined.startsWith('write') || joined.startsWith('draft') || joined.startsWith('ii diyaari')) && toks.length >= 2) {
    const kind: 'email' | 'message' | 'text' = has(toks, /^(email|emailka|iimayl|imayl|warqad|warqadda|mail)$/)
      ? 'email'
      : has(toks, /^(fariin|fariinta|message|sms)$/)
        ? 'message'
        : 'text';
    const topicToks = toks.filter(
      (t, i) => i > 1 && !/^(email|emailka|iimayl|imayl|warqad|warqadda|mail|fariin|fariinta|message|ah|oo)$/.test(t.n) && detectLangWord([t]) === null,
    );
    return R({ type: 'draft_text', kind, language: detectLangWord(toks), topic: topicToks.map((t) => t.raw).join(' ') }, 0.82);
  }
  if (/^(ku dheji|paste|halkan ku dheji)/.test(joined)) {
    return R({ type: 'paste_text', target: cleanTarget(toks.slice(2)) || undefined }, 0.8);
  }

  // 12. YouTube playback
  const ytMentioned = has(toks, /^(youtube|yutuub|yuutuub|youtub)$/);
  const playIdx = toks.findIndex((t) => ['shid', 'daawo', 'play', 'daar'].includes(t.n));
  if (playIdx >= 0 || (ytMentioned && !toks.some((t) => OPEN_VERBS.has(t.n) && t.n !== 'shid'))) {
    if (playIdx >= 0) {
      const raw = toks.filter((_, i) => i !== playIdx);
      const kind: 'song' | 'video' | 'any' = has(raw, /^(heesta|heesta|hees|song|music|muusiga|muusigga)$/)
        ? 'song'
        : has(raw, /^(muuqaal|muuqaalka|video|fiidiyow|fiidiyowga|daawo)$/)
          ? 'video'
          : 'any';
      // query: after "heesta" / "ku saabsan" / "play" if present, else everything not a keyword
      let qToks: Tok[];
      let structural = true; // title words after "heesta" / "ku saabsan" are kept verbatim
      const kuSaab = indexOfSeq(toks, ['ku', 'saabsan']);
      const heesIdx = toks.findIndex((t, i) => /^(heesta|heesteeda|song)$/.test(t.n) && i < toks.length - 1);
      if (kuSaab >= 0) qToks = toks.slice(kuSaab + 2);
      else if (heesIdx >= 0) qToks = toks.slice(heesIdx + 1);
      else {
        qToks = toks.filter((_, i) => i !== playIdx);
        structural = false;
      }
      const drop = new Set(['youtube', 'yutuub', 'yuutuub', 'gal', 'ii', 'oo', 'on', 'in', 'ku', 'fadlan', 'muuqaal', 'muuqaalka', 'video', 'hees', 'heesta', 'song', 'muusiga', 'daawo', 'shid', 'play', 'the', 'a']);
      const q = qToks
        .filter((t) => structural || !drop.has(t.n))
        .map((t) => t.raw.replace(/[,.;:!?]+$/g, ''))
        .join(' ')
        .trim();
      if (q) return R({ type: 'youtube_play', query: q, kind }, 0.88);
      if (ytMentioned) return R({ type: 'open_url', target: SITES.youtube! }, 0.8);
      return R({ type: 'media_control', action: 'resume' }, 0.6);
    }
  }
  if (ytMentioned && toks.length <= 4) return R({ type: 'open_url', target: SITES.youtube! }, 0.85);

  // 13. Files and search
  const fileWord = toks.findIndex((t) => /^(file|files|faylka|fayl|faylasha|filekii|document)$/.test(t.n));
  if (has(toks, /^(raadi|raadso|find|search|ka raadi|soo helo|hel)$/) && fileWord >= 0) {
    const rest = dropArticles(toks.filter((_, i) => i !== fileWord)).filter(
      (t) => !NOISE.has(t.n) && !/^(raadi|raadso|find|search|soo|helo|hel|for|ka|gal|folder)$/.test(t.n),
    );
    const q = rest.map((t) => t.raw.replace(/[,.;:!?]+$/g, '')).join(' ').trim();
    if (q) return R({ type: 'find_file', query: q }, 0.88);
  }
  if (joined.startsWith('search google for') || joined.startsWith('google search') || /^(google|jooggle)(\s+ka)*\s+raadi/.test(joined) || /^raadi/.test(joined) || /^ii raadi/.test(joined) || /^search\b/.test(joined)) {
    const engine = has(toks, /^bing$/) ? 'bing' : has(toks, /^(duckduckgo)$/) ? 'duckduckgo' : has(toks, /^google|jooggle$/) ? 'google' : undefined;
    const q = toks
      .filter((t) => !NOISE.has(t.n) && !/^(raadi|raadso|search|for|ka|google|jooggle|bing|duckduckgo|ii|web|the|about|on)$/.test(t.n))
      .map((t) => t.raw.replace(/[,.;:!?]+$/g, ''))
      .join(' ')
      .trim();
    if (q) return R({ type: 'web_search', query: q, engine }, 0.85);
  }

  // 14. Open things: "<thing> fur", "open <thing>"
  const verbIdx = toks.findIndex((t) => OPEN_VERBS.has(t.n) && t.n !== 'shid');
  if (verbIdx >= 0) {
    const objToks = dropArticles(toks.filter((_, i) => i !== verbIdx)).filter((t) => !NOISE.has(t.n) && !['whatsapp', 'whatsappka'].includes(t.n) || t.n === 'whatsapp');
    const obj = objToks.filter((t) => !['folder', 'folderka', 'galka', 'app', 'application', 'barnaamijka', 'barnaamij', 'website', 'site', 'browser'].includes(t.n));
    const target = obj.map((t) => t.raw.replace(/[,.;:!?]+$/g, '')).join(' ').trim();
    const t0 = normalizeText(target);
    if (t0) {
      if (['whatsapp', 'wasaap', 'watsap'].includes(t0)) return R({ type: 'open_whatsapp' }, 0.92);
      const folders = { ...BUILTIN_FOLDERS, ...(ctx.folderAliases ?? {}) };
      for (const [label, aliases] of Object.entries(folders)) {
        if (aliases.some((a) => normalizeText(a) === t0)) return R({ type: 'open_folder', folder: label }, 0.92);
      }
      if (has(toks, /^(folder|folderka|galka)$/)) return R({ type: 'open_folder', folder: target }, 0.8);
      if (t0 in SITES) return R({ type: 'open_url', target: SITES[t0]! }, 0.9);
      if (/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(target)) return R({ type: 'open_url', target }, 0.9);
      return R({ type: 'open_app', app: target }, 0.85);
    }
  }
  if (toks.length === 2 && ARTICLES.has(words[1]!) === false && OPEN_VERBS.has(words[0]!) === false) {
    /* fallthrough to chat */
  }

  return { intent: { type: 'chat', text: original }, confidence: 0.4, rule: false };
}
