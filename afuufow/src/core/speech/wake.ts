import { normalizeText, similarity } from '../memory/names';

/**
 * Wake-word matching on a transcript. Speech recognisers rarely spell a rare word like "Afuufow" the same way twice,
 * so matching is phonetic and tolerant, plus aliases learned during calibration.
 * Returns the text AFTER the wake word (so "Afuufow, Chrome fur" yields "Chrome fur").
 */
export interface WakeMatch {
  matched: boolean;
  /** command text following the wake word, '' if only the wake word was said */
  rest: string;
  score: number;
}

const BUILTIN_VARIANTS = [
  'afuufow', 'afufow', 'afufo', 'afuufo', 'afufou', 'afuufou', 'afoofow', 'afoofo', 'afufau', 'aafuufow', 'a fuufow', 'a fufow', 'af oofow', 'afu fow', 'afuuf ow', 'a fufo', 'afuf ow', 'afoof', 'afuuf',
];

function skeleton(s: string): string {
  return normalizeText(s)
    .replace(/[^a-z]/g, '')
    .replace(/ou|au|ow|aw/g, 'o')
    .replace(/(.)\1+/g, '$1')
    .replace(/[wy]/g, '');
}

export function matchWakeWord(transcript: string, wakeWord: string, aliases: string[] = []): WakeMatch {
  const norm = normalizeText(transcript);
  if (!norm) return { matched: false, rest: '', score: 0 };
  const words = norm.split(' ');
  const targets = [wakeWord, ...aliases, ...BUILTIN_VARIANTS].map((t) => skeleton(t)).filter(Boolean);
  const wakeSk = skeleton(wakeWord);
  const origWords = transcript.trim().split(/\s+/);

  let best = { score: 0, end: 0 };
  // try windows of 1..3 words from the start region of the utterance (wake word is normally first)
  for (let start = 0; start < Math.min(words.length, 4); start++) {
    for (let len = 1; len <= 3 && start + len <= words.length; len++) {
      const cand = skeleton(words.slice(start, start + len).join(''));
      if (cand.length < 2) continue;
      const score = Math.max(...targets.map((t) => similarity(cand, t)), cand === wakeSk ? 1 : 0);
      // longer candidate windows must be a bit better to win, so "afuufow chrome" does not swallow "chrome"
      const adj = score - (len - 1) * 0.02;
      if (adj > best.score) best = { score: adj, end: start + len };
    }
  }
  const matched = best.score >= 0.8;
  if (!matched) return { matched: false, rest: '', score: best.score };
  const rest = origWords.slice(best.end).join(' ').replace(/^[,.:;!?\s-]+/, '').trim();
  return { matched: true, rest, score: best.score };
}
