/**
 * Same normalisation as @vladmandic/human `match.similarity` (MIT, Vladimir Mandic): euclidean distance of face descriptors
 * mapped to 0..1. Re-implemented here so enrollment checks run in the main process without loading the vision model.
 */
export function faceSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length < 64) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    sum += d * d;
  }
  const dist = Math.round(100 * 25 * sum) / 100;
  if (dist === 0) return 1;
  const norm = (1 - Math.sqrt(dist) / 100 - 0.2) / (0.8 - 0.2);
  return Math.round(100 * Math.max(Math.min(norm, 1), 0)) / 100;
}

export function bestSimilarity(e: ArrayLike<number>, templates: number[][]): number | null {
  if (templates.length === 0) return null;
  let best = 0;
  for (const t of templates) best = Math.max(best, faceSimilarity(e, t));
  return best;
}

