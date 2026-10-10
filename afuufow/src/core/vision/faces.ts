import * as path from 'node:path';
import { type KeyProvider, EncryptedJsonFile } from '../storage/encrypted';
import { uid } from '../util';

export { faceSimilarity, bestSimilarity } from './similarity';
import { faceSimilarity } from './similarity';

export interface FaceSample {
  embedding: number[];
  /** 0..1 mean brightness of the frame */
  luminance: number;
  /** head yaw in degrees (negative = turned left) */
  yaw: number;
  qualityOk: boolean;
  qualityReason?: string;
  liveness: number | null;
}

export type Lighting = 'low' | 'normal' | 'bright';
export type Pose = 'front' | 'left' | 'right';
export const lightingOf = (l: number): Lighting => (l < 0.3 ? 'low' : l > 0.65 ? 'bright' : 'normal');
export const poseOf = (yaw: number): Pose => (yaw < -12 ? 'left' : yaw > 12 ? 'right' : 'front');

export interface EnrollProgress {
  total: number;
  target: number;
  lighting: Record<Lighting, number>;
  pose: Record<Pose, number>;
  complete: boolean;
  hintSo: string;
  hintEn: string;
}

export type AddResult = { accepted: true; progress: EnrollProgress } | { accepted: false; reason: 'quality' | 'photo' | 'duplicate' | 'inconsistent' | 'no_embedding'; so: string; en: string; progress: EnrollProgress };

/** Guided enrollment: several samples, different poses and lighting, one consistent person, live (not a photo) where the model can tell. */
export class FaceEnrollment {
  private samples: FaceSample[] = [];
  constructor(
    private target = 10,
    private minLightingBuckets = 2,
    private requireLiveness = true,
  ) {}

  progress(): EnrollProgress {
    const lighting: Record<Lighting, number> = { low: 0, normal: 0, bright: 0 };
    const pose: Record<Pose, number> = { front: 0, left: 0, right: 0 };
    for (const s of this.samples) {
      lighting[lightingOf(s.luminance)]++;
      pose[poseOf(s.yaw)]++;
    }
    const lightBuckets = Object.values(lighting).filter((n) => n > 0).length;
    const complete = this.samples.length >= this.target && pose.front >= 3 && pose.left >= 1 && pose.right >= 1 && lightBuckets >= this.minLightingBuckets;
    let hintSo = 'Si fiican u eeg kamaradda.';
    let hintEn = 'Look straight at the camera.';
    if (pose.front < 3) { hintSo = 'Si toos ah u eeg kamaradda.'; hintEn = 'Look straight at the camera.'; }
    else if (pose.left < 1) { hintSo = 'Madaxa yar u leexi dhanka bidix.'; hintEn = 'Turn your head slightly to the left.'; }
    else if (pose.right < 1) { hintSo = 'Madaxa yar u leexi dhanka midig.'; hintEn = 'Turn your head slightly to the right.'; }
    else if (lightBuckets < this.minLightingBuckets) { hintSo = 'Iftiinka beddel (tusaale: ag u soco daaqadda ama shid/dami nalka).'; hintEn = 'Change the lighting (move near a window or switch a lamp on/off).'; }
    else if (this.samples.length < this.target) { hintSo = 'Sii wad, wax yar ayaa haray.'; hintEn = 'Keep going, almost there.'; }
    else { hintSo = 'Dhammaystiran!'; hintEn = 'Complete!'; }
    return { total: this.samples.length, target: this.target, lighting, pose, complete, hintSo, hintEn };
  }

  add(s: FaceSample): AddResult {
    const progress = this.progress();
    if (!s.embedding || s.embedding.length < 64) return { accepted: false, reason: 'no_embedding', so: 'Wajiga lama helin.', en: 'No face descriptor.', progress };
    if (!s.qualityOk) return { accepted: false, reason: 'quality', so: `Tayada sawirku way hooseysaa (${s.qualityReason ?? 'iftiin/cabbir'}).`, en: `Image quality too low (${s.qualityReason ?? 'light/size'}).`, progress };
    if (this.requireLiveness && s.liveness !== null && s.liveness < 0.5) return { accepted: false, reason: 'photo', so: 'Waxay u egtahay sawir; wajigaaga dhabta ah u muuji.', en: 'This looks like a photo; show your live face.', progress };
    if (this.samples.some((x) => faceSimilarity(x.embedding, s.embedding) >= 0.99)) return { accepted: false, reason: 'duplicate', so: 'Madaxa yar dhaq oo mar kale isku day.', en: 'Move slightly and try again.', progress };
    if (this.samples.length >= 3) {
      const mean = this.samples.reduce((a, x) => a + faceSimilarity(x.embedding, s.embedding), 0) / this.samples.length;
      if (mean < 0.35) return { accepted: false, reason: 'inconsistent', so: 'Wajigani ma dhigmo kuwii hore; hubi inuu adigu kaliya jiro.', en: 'This face does not match the earlier samples; make sure only you are in view.', progress };
    }
    this.samples.push(s);
    return { accepted: true, progress: this.progress() };
  }

  get count() {
    return this.samples.length;
  }

  finish(): { templates: number[][]; stats: { mean: number; p10: number; min: number }; suggested: { matchThreshold: number; unknownCeiling: number }; lightingBuckets: Lighting[] } {
    const p = this.progress();
    if (!p.complete) throw new Error('enrollment is not complete');
    const sims: number[] = [];
    for (let i = 0; i < this.samples.length; i++) for (let j = i + 1; j < this.samples.length; j++) sims.push(faceSimilarity(this.samples[i]!.embedding, this.samples[j]!.embedding));
    sims.sort((a, b) => a - b);
    const mean = sims.reduce((a, b) => a + b, 0) / sims.length;
    const p10 = sims[Math.floor(sims.length * 0.1)] ?? mean;
    const match = Math.max(0.5, Math.min(0.8, Math.round((p10 - 0.05) * 100) / 100));
    return {
      templates: this.samples.map((s) => s.embedding),
      stats: { mean, p10, min: sims[0] ?? mean },
      suggested: { matchThreshold: match, unknownCeiling: Math.max(0.2, Math.round((match - 0.15) * 100) / 100) },
      lightingBuckets: (Object.entries(p.lighting) as Array<[Lighting, number]>).filter(([, n]) => n > 0).map(([k]) => k),
    };
  }
}

interface Doc {
  version: 1;
  owner: { templates: number[][]; enrolledAt: number; lightingBuckets: string[] } | null;
  known: Array<{ id: string; label: string; templates: number[][]; enrolledAt: number }>;
}

/** Encrypted face templates. Raw images are never stored; only numeric descriptors that cannot be shown as a picture. */
export class FaceStore {
  private file: EncryptedJsonFile<Doc>;
  constructor(dir: string, keys: KeyProvider) {
    this.file = new EncryptedJsonFile<Doc>(path.join(dir, 'faces.afu'), keys, () => ({ version: 1, owner: null, known: [] }));
  }
  async load() {
    await this.file.load();
  }
  flush() {
    return this.file.flush();
  }
  get enrolled(): boolean {
    return !!this.file.data.owner;
  }
  get ownerTemplates(): number[][] {
    return this.file.data.owner?.templates ?? [];
  }
  get known() {
    return this.file.data.known;
  }
  info() {
    const o = this.file.data.owner;
    return { enrolled: !!o, samples: o?.templates.length ?? 0, enrolledAt: o?.enrolledAt ?? null, known: this.file.data.known.map((k) => ({ id: k.id, label: k.label, samples: k.templates.length })) };
  }
  setOwner(templates: number[][], lightingBuckets: string[]) {
    this.file.update((d) => {
      d.owner = { templates, enrolledAt: Date.now(), lightingBuckets };
    });
  }
  addKnown(label: string, templates: number[][]) {
    const id = uid('k_');
    this.file.update((d) => d.known.push({ id, label, templates, enrolledAt: Date.now() }));
    return id;
  }
  removeKnown(id: string) {
    this.file.update((d) => {
      d.known = d.known.filter((k) => k.id !== id);
    });
  }
  /** Complete deletion: owner template, known people, and the encrypted files. */
  async deleteAll() {
    await this.file.destroy();
  }
  async deleteOwner() {
    this.file.update((d) => {
      d.owner = null;
    });
    await this.file.flush();
  }
}
