/** Heuristics for what a visitor SAYS about themselves. Everything returned is self-reported and unverified. */

const DECLINE = [
  /\bma\s+(doonayo|doonayaa|rabo|sheegayo|sheegi\s+maayo)\b/i,
  /\bsheegi\s+maayo\b/i,
  /\bha\s+i\s+weydiin\b/i,
  /\b(maya|haa\s*yo)\b.*\b(magac|sheeg)/i,
  /^\s*(no|nope|maya|ha)\s*[.!]?\s*$/i,
  /\b(i\s+(don'?t|do\s+not)\s+want|none\s+of\s+your|no\s+comment|won'?t\s+say|refuse)\b/i,
];

export function isDecline(text: string): boolean {
  return DECLINE.some((r) => r.test(text.trim()));
}

const NAME_PATTERNS: RegExp[] = [
  /\bmagac(?:aygu|eyga|ayga|aygu)\s+waa\s+([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2})/iu,
  /\bwaxaan\s+ahay\s+([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2})/iu,
  /\bwaxaa\s+la\s+i\s+yidhaahdaa\s+([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2})/iu,
  /\banigu\s+waa\s+([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2})/iu,
  /\bmy\s+name\s+is\s+([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2})/iu,
  /\bi(?:'|’)?m\s+([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,1})/iu,
  /\bi\s+am\s+([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,1})/iu,
];

const NOT_A_NAME = new Set(['a', 'an', 'the', 'here', 'there', 'to', 'from', 'ok', 'okay', 'sorry', 'friend', 'sheeg', 'saaxiib', 'looking', 'waiting', 'just', 'only', 'not', 'new', 'with', 'for', 'at', 'in', 'on', 'so', 'very', 'really']);
const STOP_AFTER = /\b(oo|iyo|waxaan|waan|and|because|from|hassan|boss)\b/i;

export function extractSelfReportedName(text: string): string | null {
  for (const re of NAME_PATTERNS) {
    const m = re.exec(text);
    if (m?.[1]) {
      let n = m[1].trim();
      const cut = STOP_AFTER.exec(n);
      if (cut && cut.index > 0) n = n.slice(0, cut.index).trim();
      const first = n.split(/\s+/)[0]!.toLowerCase();
      if (n && n.length <= 40 && !NOT_A_NAME.has(first)) return n;
    }
  }
  return null;
}
