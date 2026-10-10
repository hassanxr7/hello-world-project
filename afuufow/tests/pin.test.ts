import { describe, expect, it } from 'vitest';
import { PinLimiter, hashPin, validPinFormat, verifyPinHash } from '../src/core/permissions/pin';

describe('owner PIN', () => {
  it('verifies the right PIN and rejects others; hashes are salted and never contain the PIN', () => {
    const h = hashPin('482915');
    expect(h).not.toContain('482915');
    expect(verifyPinHash('482915', h)).toBe(true);
    expect(verifyPinHash('482916', h)).toBe(false);
    expect(hashPin('482915')).not.toBe(h);
  });
  it('rejects malformed stored hashes', () => {
    expect(verifyPinHash('1234', 'garbage')).toBe(false);
    expect(verifyPinHash('1234', 'scrypt1::')).toBe(false);
  });
  it('format: 4-12 digits only', () => {
    expect(validPinFormat('1234')).toBe(true);
    expect(validPinFormat('123')).toBe(false);
    expect(validPinFormat('12ab')).toBe(false);
  });
  it('locks out after 5 failures, with growing lock time', () => {
    const c = { t: 0 };
    const l = new PinLimiter(() => c.t);
    for (let i = 0; i < 5; i++) l.fail();
    expect(l.lockedFor()).toBe(60_000);
    c.t = 61_000;
    expect(l.lockedFor()).toBe(0);
    for (let i = 0; i < 5; i++) l.fail();
    expect(l.lockedFor()).toBe(120_000);
    l.success();
    expect(l.lockedFor()).toBe(0);
  });
});
