/**
 * Name and application-name matching tuned for Somali orthography and English transliterations.
 * Somali: x = /ħ/ (English h), c = /ʕ/ (silent in English), q ~ k/q, dh ~ d, kh ~ h, sh ~ sh.
 * So "Axmed" ~ "Ahmed", "Maxamed" ~ "Mohamed", "Cabdi" ~ "Abdi", "Xasan" ~ "Hassan".
 */

export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizeText(s: string): string {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Consonant skeleton used for fuzzy phonetic comparison. */
export function phoneticKey(name: string): string {
  let s = normalizeText(name).replace(/['-]/g, '');
  s = s
    .replace(/kh/g, 'h')
    .replace(/gh/g, 'g')
    .replace(/dh/g, 'd')
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/ch/g, 'j')
    .replace(/sh/g, 's')
    .replace(/x/g, 'h')
    .replace(/c/g, '')
    .replace(/q/g, 'k')
    .replace(/w/g, 'u')
    .replace(/y/g, 'i')
    .replace(/(.)\1+/g, '$1');
  // drop vowels after the first letter
  const first = s[0] ?? '';
  const rest = s.slice(1).replace(/[aeiou]/g, '');
  // a leading h (Ahmed/Axmed -> 'a','h'...) is kept, vowels removed
  return (first.replace(/[aeiou]/, 'a') + rest).replace(/(.)\1+/g, '$1');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length, 1);
}

/** 0..1 similarity between a spoken name and a stored name/alias. */
export function nameScore(spoken: string, stored: string): number {
  const a = normalizeText(spoken);
  const b = normalizeText(stored);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const plain = similarity(a, b);
  const ka = phoneticKey(a);
  const kb = phoneticKey(b);
  // very short keys are unreliable
  const phon = ka.length >= 2 && kb.length >= 2 ? similarity(ka, kb) : 0;
  // 0.92 cap: phonetic-only equality must never outrank an exact textual match
  return Math.max(plain, phon * 0.92);
}
