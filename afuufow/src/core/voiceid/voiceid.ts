import * as path from 'node:path';
import { type KeyProvider, EncryptedJsonFile } from '../storage/encrypted';

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export type VoiceVerdict = { verdict: 'owner' | 'uncertain' | 'other'; score: number };

/**
 * Optional speaker recognition. IMPORTANT: a voice match only ever yields the "voice" assurance level, which never
 * unlocks private or sensitive actions (a recording could replay it). It personalises and filters, nothing more.
 */
export function judgeVoice(emb: ArrayLike<number>, templates: number[][], threshold: number, band: number): VoiceVerdict {
  if (templates.length === 0) return { verdict: 'other', score: 0 };
  const scores = templates.map((t) => cosine(emb, t)).sort((a, b) => b - a);
  const top = scores.slice(0, Math.min(3, scores.length));
  const score = top.reduce((a, b) => a + b, 0) / top.length;
  if (score >= threshold) return { verdict: 'owner', score };
  if (score >= threshold - band) return { verdict: 'uncertain', score };
  return { verdict: 'other', score };
}

export class VoiceEnrollment {
  private samples: Array<{ emb: number[]; seconds: number }> = [];
  constructor(
    private target = 6,
    private minSeconds = 1.5,
  ) {}
  add(emb: ArrayLike<number>, seconds: number): { accepted: boolean; so: string; en: string; count: number } {
    if (seconds < this.minSeconds) return { accepted: false, so: 'Aad u gaaban; mar kale hadal wax dheer.', en: 'Too short; speak a little longer.', count: this.samples.length };
    const e = Array.from(emb);
    if (this.samples.length >= 2) {
      const mean = this.samples.reduce((a, s) => a + cosine(s.emb, e), 0) / this.samples.length;
      if (mean < 0.3) return { accepted: false, so: 'Codkani ma dhigmo kuwii hore.', en: 'This voice does not match the earlier samples.', count: this.samples.length };
    }
    this.samples.push({ emb: e, seconds });
    return { accepted: true, so: 'Waa la qaatay.', en: 'Sample accepted.', count: this.samples.length };
  }
  get complete() {
    return this.samples.length >= this.target;
  }
  get count() {
    return this.samples.length;
  }
  finish(): { templates: number[][]; suggestedThreshold: number } {
    if (!this.complete) throw new Error('voice enrollment is not complete');
    const sims: number[] = [];
    for (let i = 0; i < this.samples.length; i++) for (let j = i + 1; j < this.samples.length; j++) sims.push(cosine(this.samples[i]!.emb, this.samples[j]!.emb));
    sims.sort((a, b) => a - b);
    const p10 = sims[Math.floor(sims.length * 0.1)] ?? 0.6;
    return { templates: this.samples.map((s) => s.emb), suggestedThreshold: Math.max(0.35, Math.min(0.8, Math.round((p10 - 0.05) * 100) / 100)) };
  }
}

interface Doc {
  version: 1;
  owner: { templates: number[][]; enrolledAt: number; model: string } | null;
}

export class VoiceStore {
  private file: EncryptedJsonFile<Doc>;
  constructor(dir: string, keys: KeyProvider) {
    this.file = new EncryptedJsonFile<Doc>(path.join(dir, 'voice.afu'), keys, () => ({ version: 1, owner: null }));
  }
  async load() {
    await this.file.load();
  }
  flush() {
    return this.file.flush();
  }
  get enrolled() {
    return !!this.file.data.owner;
  }
  get templates() {
    return this.file.data.owner?.templates ?? [];
  }
  set(templates: number[][], model: string) {
    this.file.update((d) => {
      d.owner = { templates, enrolledAt: Date.now(), model };
    });
  }
  async deleteAll() {
    await this.file.destroy();
  }
}
