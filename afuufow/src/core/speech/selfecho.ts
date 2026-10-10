import { normalizeText } from '../memory/names';

/**
 * Prevents the assistant from reacting to its own voice. Every phrase we speak is remembered for a while;
 * a transcript that mostly consists of words we just said (while we were speaking, or just after) is an echo.
 * This complements Chromium's echo cancellation and half-duplex gating in the audio worker.
 */
export class SelfSpeechFilter {
  private spoken: Array<{ words: string[]; at: number }> = [];
  private speakingUntil = 0;

  constructor(
    private ttlMs = 20_000,
    private now: () => number = Date.now,
  ) {}

  noteSpeaking(text: string, estimatedMs: number) {
    const words = normalizeText(text).split(' ').filter(Boolean);
    this.spoken.push({ words, at: this.now() });
    this.speakingUntil = Math.max(this.speakingUntil, this.now() + estimatedMs);
    this.gc();
  }
  speechEnded() {
    this.speakingUntil = this.now() + 600; // tail of room echo
  }
  isSpeaking(): boolean {
    return this.now() < this.speakingUntil;
  }

  private gc() {
    const t = this.now();
    this.spoken = this.spoken.filter((s) => t - s.at <= this.ttlMs);
  }

  /** True if `transcript` is (mostly) our own recent speech. */
  isEcho(transcript: string): boolean {
    this.gc();
    const words = normalizeText(transcript).split(' ').filter(Boolean);
    if (words.length === 0) return false;
    const pool = new Set(this.spoken.flatMap((s) => s.words));
    if (pool.size === 0) return false;
    const hit = words.filter((w) => pool.has(w)).length;
    const ratio = hit / words.length;
    // while we are talking, a lower overlap is already suspicious; afterwards demand a strong overlap
    return this.isSpeaking() ? ratio >= 0.6 : ratio >= 0.85 && words.length >= 3;
  }
}
