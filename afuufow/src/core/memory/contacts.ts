import type { Contact } from '../../shared/types';
import { nameScore, normalizeText } from './names';

export type Resolution =
  | { kind: 'resolved'; contact: Contact; score: number }
  | { kind: 'ambiguous'; candidates: Contact[] }
  | { kind: 'uncertain'; contact: Contact; score: number }
  | { kind: 'not_approved'; contact: Contact }
  | { kind: 'not_found' };

export const MIN_SCORE = 0.78;
export const CONFIDENT_SCORE = 0.86;
const TIE_MARGIN = 0.06;

export function scoreContact(spoken: string, c: Contact): number {
  const names = [c.displayName, ...c.aliases];
  let best = 0;
  for (const n of names) {
    best = Math.max(best, nameScore(spoken, n));
    const toks = normalizeText(n).split(' ');
    const spokenToks = normalizeText(spoken).split(' ');
    if (toks.length > 1 && spokenToks.length === 1) {
      // "Ahmed" vs "Ahmed Ali": a first/last-name match is a bit weaker than a full match
      for (const t of toks) best = Math.max(best, nameScore(spoken, t) * 0.97);
    }
  }
  return best;
}

/**
 * Resolve a spoken recipient. Never guesses: close ties are "ambiguous", weak matches
 * are "uncertain", and contacts the owner has not approved are never returned as resolved.
 */
export function resolveContact(spoken: string, contacts: Contact[]): Resolution {
  const scored = contacts
    .map((c) => ({ c, s: scoreContact(spoken, c) }))
    .filter((x) => x.s >= MIN_SCORE)
    .sort((a, b) => b.s - a.s);
  if (scored.length === 0) return { kind: 'not_found' };

  const top = scored[0]!;
  const tied = scored.filter((x) => top.s - x.s < TIE_MARGIN);
  if (tied.length > 1) return { kind: 'ambiguous', candidates: tied.map((x) => x.c) };
  if (!top.c.approved) return { kind: 'not_approved', contact: top.c };
  if (!top.c.phone) return { kind: 'not_found' };
  if (top.s < CONFIDENT_SCORE) return { kind: 'uncertain', contact: top.c, score: top.s };
  return { kind: 'resolved', contact: top.c, score: top.s };
}

const ORDINALS: Array<[RegExp, number]> = [
  [/\b(1|kowaad|koowaad|hore|kan hore|midka hore|first|one|kow)\b/, 0],
  [/\b(2|labaad|midka labaad|kan labaad|second|two|labo)\b/, 1],
  [/\b(3|saddexaad|sadexaad|third|three|saddex)\b/, 2],
  [/\b(4|afraad|fourth|four|afar)\b/, 3],
];

/** The owner answers "which one?" — by position or by name. Returns null if still unclear. */
export function pickFromCandidates(utterance: string, candidates: Contact[]): Contact | null {
  const u = normalizeText(utterance);
  for (const [re, idx] of ORDINALS) {
    if (re.test(u) && candidates[idx]) return candidates[idx]!;
  }
  const scored = candidates
    .map((c) => ({ c, s: scoreContact(u, c) }))
    .sort((a, b) => b.s - a.s);
  const top = scored[0];
  if (!top || top.s < CONFIDENT_SCORE) return null;
  const second = scored[1];
  if (second && top.s - second.s < TIE_MARGIN) return null;
  return top.c;
}

export function describeContact(c: Contact): string {
  const tail = c.phone.slice(-3);
  return `${c.displayName} (…${tail})`;
}
