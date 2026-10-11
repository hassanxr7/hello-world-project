import { describe, expect, it } from 'vitest';
import { type HandFrame, type RawHand, HandTracker, isOpenPalm, projectHand } from '../src/core/vision/hands';

const W = 640;
const H = 480;

/** A synthetic open hand (fingers up) with the wrist at (cx, cy) in video pixels; `curl` folds the four fingers. */
function hand(cx: number, cy: number, o: { curl?: boolean; score?: number; label?: string } = {}): RawHand {
  const kp: number[][] = [];
  kp.push([cx, cy, 0]); // wrist
  // thumb
  for (let i = 1; i <= 4; i++) kp.push([cx - 20 - i * 8, cy - i * 14, -i]);
  // four fingers, base to tip
  const xs = [-14, 0, 14, 28];
  for (const x of xs) {
    for (let j = 1; j <= 4; j++) {
      const len = o.curl ? [30, 36, 30, 22][j - 1]! : j * 22 + 30;
      kp.push([cx + x, o.curl && j > 2 ? cy - 60 + (j - 2) * 14 : cy - len, -j]);
    }
  }
  return { label: o.label ?? 'hand', score: o.score ?? 0.9, keypoints: kp };
}
const frame = (ts: number, hands: RawHand[]): HandFrame => ({ ts, width: W, height: H, hands });

describe('hand tracking', () => {
  it('open palm vs fist', () => {
    const tr = new HandTracker({ smoothing: 1 });
    const open = tr.update(frame(0, [hand(320, 400)])).hands[0]!;
    expect(open.openPalm).toBe(true);
    const tr2 = new HandTracker({ smoothing: 1 });
    expect(tr2.update(frame(0, [hand(320, 400, { curl: true })])).hands[0]!.openPalm).toBe(false);
    expect(isOpenPalm(open.pts)).toBe(true);
  });

  it('normalises to 0..1 and mirrors horizontally like a mirror', () => {
    const tr = new HandTracker({ smoothing: 1 });
    const v = tr.update(frame(0, [hand(160, 240)])); // hand on the left of the camera image
    const w = v.hands[0]!.pts[0]!;
    expect(w[0]).toBeCloseTo(1 - 160 / W, 5); // appears on the RIGHT of the screen
    expect(w[1]).toBeCloseTo(0.5, 5);
  });

  it('smooths: moves part of the way each frame and converges', () => {
    const tr = new HandTracker({ smoothing: 0.5 });
    tr.update(frame(0, [hand(100, 300)]));
    const a = tr.update(frame(66, [hand(300, 300)])).hands[0]!.pts[0]![0];
    const start = 1 - 100 / W;
    const target = 1 - 300 / W;
    expect(a).toBeGreaterThan(Math.min(start, target));
    expect(a).toBeLessThan(Math.max(start, target));
    let last = a;
    for (let i = 2; i < 12; i++) last = tr.update(frame(i * 66, [hand(300, 300)])).hands[0]!.pts[0]![0];
    expect(last).toBeCloseTo(target, 2);
  });

  it('ignores low-confidence, malformed and extra detections', () => {
    const tr = new HandTracker();
    const bad: RawHand[] = [
      hand(300, 300, { score: 0.1 }),
      { label: 'x', score: 0.9, keypoints: [[1, 2, 3]] },
      { label: 'x', score: 0.9, keypoints: Array.from({ length: 21 }, () => [NaN, 1, 0]) },
    ];
    expect(tr.update(frame(0, bad)).hands).toHaveLength(0);
    const three = tr.update(frame(66, [hand(100, 300), hand(300, 300), hand(500, 300)]));
    expect(three.hands.length).toBeLessThanOrEqual(2);
  });

  it('keeps two hands in stable slots across frames', () => {
    const tr = new HandTracker({ smoothing: 1 });
    const a = tr.update(frame(0, [hand(120, 300), hand(520, 300)]));
    const slotOfLeft = a.hands.find((h) => h.pts[0]![0] > 0.5)!.slot; // video-left is screen-right after mirroring
    const b = tr.update(frame(66, [hand(130, 300), hand(510, 300)]));
    expect(b.hands.find((h) => h.pts[0]![0] > 0.5)!.slot).toBe(slotOfLeft);
    expect(new Set(b.hands.map((h) => h.slot)).size).toBe(2);
  });

  describe('when the stage opens', () => {
    const wave = (tr: HandTracker, from = 0, n = 14, openHand = true) => {
      let v = tr.update(frame(from, [hand(300, 300, { curl: !openHand })]));
      for (let i = 1; i < n; i++) v = tr.update(frame(from + i * 66, [hand(300 + (i % 2 ? 60 : -60), 300, { curl: !openHand })]));
      return v;
    };
    it('opens when an OPEN hand is waved', () => {
      const v = wave(new HandTracker({ smoothing: 1 }));
      expect(v.waving).toBe(true);
      expect(v.active).toBe(true);
    });
    it('does not open for a resting hand, for a moving fist, or for small jitter', () => {
      const tr = new HandTracker({ smoothing: 1 });
      let v = tr.update(frame(0, [hand(300, 300)]));
      for (let i = 1; i < 30; i++) v = tr.update(frame(i * 66, [hand(300 + (i % 2), 300)]));
      expect(v.active).toBe(false);
      expect(wave(new HandTracker({ smoothing: 1 }), 0, 14, false).active).toBe(false);
    });
    it('stays open while the hands keep moving, then closes after the hold time', () => {
      const tr = new HandTracker({ smoothing: 1, holdMs: 2000 });
      wave(tr);
      let v = tr.idle(1500);
      expect(v.active).toBe(true); // still within the hold time after the last wave frame (~860 ms)
      v = tr.idle(4000);
      expect(v.active).toBe(false);
    });
    it('survives a brief detection dropout without flicker', () => {
      const tr = new HandTracker({ smoothing: 1 });
      wave(tr);
      expect(tr.idle(1000).active).toBe(true);
      expect(tr.update(frame(1066, [hand(300, 300)])).active).toBe(true);
    });
    it('manual open stays until dismissed; Esc/close dismisses', () => {
      const tr = new HandTracker();
      tr.setManual(true);
      expect(tr.idle(0).active).toBe(true);
      expect(tr.idle(60_000).active).toBe(true);
      tr.dismiss();
      expect(tr.idle(60_100).active).toBe(false);
    });
  });
});

describe('projectHand (stage geometry)', () => {
  const tr = new HandTracker({ smoothing: 1 });
  const h = tr.update(frame(0, [hand(320, 300)])).hands[0]!;
  it('the wrist follows the real wrist across the screen', () => {
    const p = projectHand(h, 1920, 1000);
    expect(p.pts[0]![0]).toBeCloseTo(h.pts[0]![0] * 1920, 0);
    expect(p.pts[0]![1]).toBeCloseTo(h.pts[0]![1] * 1000, 0);
  });
  it('draws the hand larger than in the camera without stretching it', () => {
    const small = projectHand(h, 1920, 1000, 4 / 3, 1);
    const big = projectHand(h, 1920, 1000, 4 / 3, 2);
    const span = (pr: ReturnType<typeof projectHand>) => Math.max(...pr.pts.map((q) => q[1])) - Math.min(...pr.pts.map((q) => q[1]));
    const spanX = (pr: ReturnType<typeof projectHand>) => Math.max(...pr.pts.map((q) => q[0])) - Math.min(...pr.pts.map((q) => q[0]));
    expect(span(big) / span(small)).toBeCloseTo(2, 1);
    expect(spanX(big) / spanX(small)).toBeCloseTo(2, 1);
  });
  it('keeps a hand at the edge inside the stage', () => {
    const edge = new HandTracker({ smoothing: 1 }).update(frame(0, [hand(10, 470)])).hands[0]!;
    const p = projectHand(edge, 1280, 720);
    for (const [x, y] of p.pts) {
      expect(x).toBeGreaterThanOrEqual(23);
      expect(x).toBeLessThanOrEqual(1280 - 23);
      expect(y).toBeGreaterThanOrEqual(23);
      expect(y).toBeLessThanOrEqual(720 - 23);
    }
  });
});
