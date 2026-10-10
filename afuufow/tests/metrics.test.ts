import { describe, expect, it } from 'vitest';
import { charErrors, normalizeForScoring, percentile, summarise, wordErrors } from '../src/core/speech/metrics';

describe('speech metrics', () => {
  it('normalises case, punctuation and curly quotes', () => expect(normalizeForScoring('“Si guud”, marka  loo!')).toBe('si guud marka loo'));
  it('counts word errors (substitution, deletion, insertion)', () => {
    expect(wordErrors('a b c', 'a b c')).toEqual({ errors: 0, words: 3 });
    expect(wordErrors('a b c', 'a x c')).toEqual({ errors: 1, words: 3 });
    expect(wordErrors('a b c', 'a c')).toEqual({ errors: 1, words: 3 });
    expect(wordErrors('a b', 'a b c d')).toEqual({ errors: 2, words: 2 });
  });
  it('WER can exceed 100% (hallucinated extra words)', () => {
    const s = summarise([{ ref: 'a b', hyp: 'x y z w', ms: 10, seconds: 1 }]);
    expect(s.wer).toBe(2);
  });
  it('failed requests count as complete errors, never as silence', () => {
    const s = summarise([{ ref: 'a b c d', hyp: '', ms: 0, seconds: 0, failed: true }, { ref: 'a b', hyp: 'a b', ms: 100, seconds: 2 }]);
    expect(s.failures).toBe(1);
    expect(s.wer).toBeCloseTo(4 / 6);
    expect(s.exactMatchRate).toBe(0.5);
  });
  it('char errors and percentiles', () => {
    expect(charErrors('abc', 'abd').errors).toBe(1);
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
    expect(percentile([10, 20, 30, 40, 50], 95)).toBe(50);
  });
});
