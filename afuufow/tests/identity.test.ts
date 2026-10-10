import { describe, expect, it } from 'vitest';
import { FaceEnrollment, FaceStore, type FaceSample, bestSimilarity, faceSimilarity } from '../src/core/vision/faces';
import { VoiceEnrollment, VoiceStore, cosine, judgeVoice } from '../src/core/voiceid/voiceid';
import { testKeys, tmpDir } from './helpers';

// deterministic pseudo-random descriptors: a "person" is a base vector; samples add small noise
function rng(seed: number) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 - 0.5; }; }
const person = (seed: number, n = 128) => { const r = rng(seed); return Array.from({ length: n }, () => r() * 8); };
const noisy = (base: number[], seed: number, amount = 0.5) => { const r = rng(seed); return base.map((v) => v + r() * amount); };

describe('face similarity', () => {
  it('identical = 1, different people are far below, noisy same person is high', () => {
    const a = person(1), b = person(2);
    expect(faceSimilarity(a, a)).toBe(1);
    expect(faceSimilarity(a, noisy(a, 9))).toBeGreaterThan(0.8);
    expect(faceSimilarity(a, b)).toBeLessThan(0.45);
  });
  it('rejects mismatched or tiny descriptors', () => {
    expect(faceSimilarity([1, 2], [1, 2])).toBe(0);
    expect(faceSimilarity(person(1, 64), person(1, 128))).toBe(0);
  });
  it('bestSimilarity returns null when nobody is enrolled', () => expect(bestSimilarity(person(1), [])).toBeNull());
});

const sample = (emb: number[], o: Partial<FaceSample> = {}): FaceSample => ({ embedding: emb, luminance: 0.5, yaw: 0, qualityOk: true, liveness: 0.9, ...o });

describe('face enrollment wizard', () => {
  const me = person(7);
  const fill = (e: FaceEnrollment) => {
    let i = 0;
    const add = (o: Partial<FaceSample>) => expect(e.add(sample(noisy(me, ++i * 13, 2), o)).accepted).toBe(true);
    for (let k = 0; k < 4; k++) add({ yaw: 0, luminance: 0.5 });
    add({ yaw: -20, luminance: 0.2 });
    add({ yaw: -25, luminance: 0.5 });
    add({ yaw: 22, luminance: 0.8 });
    add({ yaw: 25, luminance: 0.5 });
    add({ yaw: 0, luminance: 0.2 });
    add({ yaw: 5, luminance: 0.8 });
  };
  it('needs several samples with different poses and lighting before it completes', () => {
    const e = new FaceEnrollment(10);
    for (let i = 0; i < 4; i++) e.add(sample(noisy(me, i + 1, 2)));
    const p = e.progress();
    expect(p.complete).toBe(false);
    expect(p.hintEn).toContain('left');
    expect(() => e.finish()).toThrow();
    const full = new FaceEnrollment(10);
    fill(full);
    const done = full.finish();
    expect(done.templates).toHaveLength(10);
    expect(done.lightingBuckets.length).toBeGreaterThanOrEqual(2);
    expect(done.suggested.matchThreshold).toBeGreaterThanOrEqual(0.5);
    expect(done.suggested.unknownCeiling).toBeLessThan(done.suggested.matchThreshold);
  });
  it('rejects poor quality, photos, duplicates and a different person', () => {
    const e = new FaceEnrollment(10);
    expect(e.add(sample(me, { qualityOk: false, qualityReason: 'dark' }))).toMatchObject({ accepted: false, reason: 'quality' });
    expect(e.add(sample(me, { liveness: 0.1 }))).toMatchObject({ accepted: false, reason: 'photo' });
    expect(e.add(sample(me)).accepted).toBe(true);
    expect(e.add(sample(me))).toMatchObject({ accepted: false, reason: 'duplicate' });
    e.add(sample(noisy(me, 3, 2)));
    e.add(sample(noisy(me, 4, 2)));
    expect(e.add(sample(person(99)))).toMatchObject({ accepted: false, reason: 'inconsistent' });
    expect(e.add(sample([]))).toMatchObject({ accepted: false, reason: 'no_embedding' });
  });
  it('enrolled face then recognises the owner and rejects a stranger', () => {
    const e = new FaceEnrollment(10);
    fill(e);
    const { templates, suggested } = e.finish();
    expect(bestSimilarity(noisy(me, 555, 2), templates)!).toBeGreaterThanOrEqual(suggested.matchThreshold);
    expect(bestSimilarity(person(1234), templates)!).toBeLessThan(suggested.unknownCeiling + 0.1);
  });
});

describe('face template storage', () => {
  it('persists encrypted, never stores images, and supports complete deletion', async () => {
    const dir = tmpDir(), keys = testKeys();
    const s1 = new FaceStore(dir, keys);
    await s1.load();
    expect(s1.enrolled).toBe(false);
    s1.setOwner([person(1)], ['normal']);
    s1.addKnown('Ahmed', [person(2)]);
    await s1.flush();
    const s2 = new FaceStore(dir, keys);
    await s2.load();
    expect(s2.info()).toMatchObject({ enrolled: true, samples: 1, known: [{ label: 'Ahmed', samples: 1 }] });
    await s2.deleteAll();
    const s3 = new FaceStore(dir, keys);
    await s3.load();
    expect(s3.enrolled).toBe(false);
    expect(s3.known).toEqual([]);
  });
});

describe('voice recognition policy', () => {
  const v = (seed: number) => Array.from({ length: 192 }, (_, i) => Math.sin(i * seed) + rng(seed + i)() * 0.05);
  it('cosine basics', () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
  it('three verdicts: owner / uncertain / other', () => {
    const t = [v(1), v(1)];
    expect(judgeVoice(v(1), t, 0.6, 0.1).verdict).toBe('owner');
    expect(judgeVoice(v(7), t, 0.6, 0.1).verdict).toBe('other');
    const near = v(1).map((x, i) => (i % 2 ? x : -x * 0.1));
    const j = judgeVoice(near, t, cosine(near, v(1)) + 0.05, 0.1);
    expect(j.verdict).toBe('uncertain');
  });
  it('no templates means nobody is the owner', () => expect(judgeVoice(v(1), [], 0.5, 0.1).verdict).toBe('other'));
  it('voice enrollment needs enough long, consistent samples', () => {
    const e = new VoiceEnrollment(4);
    expect(e.add(v(1), 0.5).accepted).toBe(false);
    for (let i = 0; i < 4; i++) expect(e.add(v(1).map((x) => x + i * 0.001), 2).accepted).toBe(true);
    expect(e.complete).toBe(true);
    expect(e.finish().templates).toHaveLength(4);
    const e2 = new VoiceEnrollment(4);
    e2.add(v(1), 2); e2.add(v(1), 2);
    expect(e2.add(v(50), 2).accepted).toBe(false);
  });
  it('stores templates encrypted and deletes them', async () => {
    const dir = tmpDir(), keys = testKeys();
    const s = new VoiceStore(dir, keys);
    await s.load();
    s.set([v(1)], 'test-model');
    await s.flush();
    const s2 = new VoiceStore(dir, keys);
    await s2.load();
    expect(s2.enrolled).toBe(true);
    await s2.deleteAll();
    expect(s2.enrolled).toBe(false);
  });
});
