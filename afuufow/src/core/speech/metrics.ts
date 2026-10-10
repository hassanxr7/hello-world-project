/** Word/character error rate and latency statistics for the speech evaluation harness. */

export function normalizeForScoring(s: string): string {
  return s
    .toLowerCase()
    .replace(/[“”„‟«»]/g, ' ')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function editDistance<T>(a: T[], b: T[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i, ...new Array<number>(b.length).fill(0)];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

export function wordErrors(ref: string, hyp: string): { errors: number; words: number } {
  const r = normalizeForScoring(ref).split(' ').filter(Boolean);
  const h = normalizeForScoring(hyp).split(' ').filter(Boolean);
  return { errors: editDistance(r, h), words: r.length };
}

export function charErrors(ref: string, hyp: string): { errors: number; chars: number } {
  const r = [...normalizeForScoring(ref)];
  const h = [...normalizeForScoring(hyp)];
  return { errors: editDistance(r, h), chars: r.length };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

export interface EvalSummary {
  clips: number;
  failures: number;
  wer: number;
  cer: number;
  exactMatchRate: number;
  latencyMsP50: number;
  latencyMsP95: number;
  audioSeconds: number;
  rtf: number;
}

export function summarise(rows: Array<{ ref: string; hyp: string; ms: number; seconds: number; failed?: boolean }>): EvalSummary {
  let we = 0, ww = 0, ce = 0, cc = 0, exact = 0, sec = 0, ms = 0, fails = 0;
  const lat: number[] = [];
  for (const r of rows) {
    if (r.failed) {
      fails++;
      const w = wordErrors(r.ref, '');
      we += w.errors; ww += w.words;
      const c = charErrors(r.ref, '');
      ce += c.errors; cc += c.chars;
      continue;
    }
    const w = wordErrors(r.ref, r.hyp);
    const c = charErrors(r.ref, r.hyp);
    we += w.errors; ww += w.words; ce += c.errors; cc += c.chars;
    if (normalizeForScoring(r.ref) === normalizeForScoring(r.hyp)) exact++;
    sec += r.seconds; ms += r.ms; lat.push(r.ms);
  }
  return {
    clips: rows.length, failures: fails, wer: ww ? we / ww : NaN, cer: cc ? ce / cc : NaN, exactMatchRate: rows.length ? exact / rows.length : NaN,
    latencyMsP50: percentile(lat, 50), latencyMsP95: percentile(lat, 95), audioSeconds: sec, rtf: sec ? ms / 1000 / sec : NaN,
  };
}
