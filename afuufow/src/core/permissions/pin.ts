import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Owner PIN: scrypt hash with a random salt. The PIN itself is never stored or logged. */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const h = scryptSync(pin, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt1:${salt.toString('hex')}:${h.toString('hex')}`;
}

export function verifyPinHash(pin: string, stored: string): boolean {
  const [tag, saltHex, hashHex] = stored.split(':');
  if (tag !== 'scrypt1' || !saltHex || !hashHex) return false;
  const h = scryptSync(pin, Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(hashHex, 'hex');
  return h.length === want.length && timingSafeEqual(h, want);
}

export function validPinFormat(pin: string): boolean {
  return /^\d{4,12}$/.test(pin);
}

/** Slows guessing: 5 wrong attempts lock the PIN prompt for 60 s, doubling each time. */
export class PinLimiter {
  private fails = 0;
  private lockedUntil = 0;
  private lockouts = 0;
  constructor(private now: () => number = Date.now) {}
  lockedFor(): number {
    return Math.max(0, this.lockedUntil - this.now());
  }
  fail() {
    this.fails++;
    if (this.fails >= 5) {
      this.fails = 0;
      this.lockedUntil = this.now() + 60_000 * 2 ** this.lockouts++;
    }
  }
  success() {
    this.fails = 0;
    this.lockouts = 0;
    this.lockedUntil = 0;
  }
}
