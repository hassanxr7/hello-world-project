import { stripDiacritics } from '../memory/names';

export interface Tok {
  raw: string;
  /** normalised: lowercase, no diacritics, no outer punctuation */
  n: string;
  start: number;
  end: number;
}

/** Split on whitespace and on hyphens (Somali definite suffixes: Downloads-ka, file-ka). Offsets index the original string. */
export function tokenize(text: string): Tok[] {
  const toks: Tok[] = [];
  const re = /[^\s\-–—]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const n = stripDiacritics(raw)
      .toLowerCase()
      .replace(/[’‘`´]/g, "'")
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    toks.push({ raw, n, start: m.index, end: m.index + raw.length });
  }
  return toks;
}

export function has(toks: Tok[], word: string | RegExp): boolean {
  return toks.some((t) => (typeof word === 'string' ? t.n === word : word.test(t.n)));
}

export function indexOfSeq(toks: Tok[], seq: string[], from = 0): number {
  for (let i = from; i + seq.length <= toks.length; i++) {
    if (seq.every((s, k) => toks[i + k]!.n === s)) return i;
  }
  return -1;
}

export function indexOfAnySeq(toks: Tok[], seqs: string[][], from = 0): { i: number; len: number } | null {
  let best: { i: number; len: number } | null = null;
  for (const s of seqs) {
    const i = indexOfSeq(toks, s, from);
    if (i >= 0 && (best === null || i < best.i || (i === best.i && s.length > best.len))) best = { i, len: s.length };
  }
  return best;
}

export function slice(text: string, toks: Tok[], from: number, to: number): string {
  if (from >= to || from >= toks.length) return '';
  return text.slice(toks[from]!.start, toks[Math.min(to, toks.length) - 1]!.end);
}

export function stripQuotes(s: string): string {
  let t = s.trim();
  const pairs: Array<[string, string]> = [
    ['“', '”'],
    ['‘', '’'],
    ['"', '"'],
    ["'", "'"],
    ['«', '»'],
    ['„', '”'],
  ];
  for (let i = 0; i < 2; i++) {
    for (const [a, b] of pairs) {
      if (t.length >= 2 && t.startsWith(a) && t.endsWith(b)) t = t.slice(a.length, t.length - b.length).trim();
    }
  }
  return t.replace(/^[:：,;\s]+/, '').trim();
}
