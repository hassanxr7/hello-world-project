/**
 * Hand tracking for the "Afuufow AI hands" stage.
 *
 * The camera worker runs a hand model (Human: palm detector + 21-point landmarks, on-device) and sends only NUMBERS
 * (21 points per hand). Nothing here stores or transmits video. This file turns those numbers into smooth, mirrored hands
 * and decides when the stage should open: an OPEN hand that is moving (a wave) - typing or resting hands do not trigger it.
 *
 * Landmark order is the MediaPipe order the model returns: 0 wrist; 1-4 thumb; 5-8 index; 9-12 middle; 13-16 ring; 17-20 pinky.
 */

export type Pt3 = [number, number, number];

export interface RawHand {
  label: string;
  score: number;
  /** 21 points [x, y, z] in video pixels. */
  keypoints: number[][];
}

export interface HandFrame {
  ts: number;
  width: number;
  height: number;
  hands: RawHand[];
}

export interface TrackedHand {
  slot: number;
  label: string;
  score: number;
  /** Normalised 0..1, already mirrored (like a mirror: your right hand is on the right of the screen) and smoothed. */
  pts: Pt3[];
  /** wrist speed, video-heights per second */
  speed: number;
  openPalm: boolean;
}

export interface HandView {
  /** The stage should be visible. */
  active: boolean;
  /** An open hand is being waved right now (the automatic trigger). */
  waving: boolean;
  hands: TrackedHand[];
}

/** Bones to draw, base to tip, per finger (thumb, index, middle, ring, pinky). */
export const FINGERS: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];
/** The palm outline. */
export const PALM: readonly number[] = [0, 1, 5, 9, 13, 17];
export const FINGERTIPS = [4, 8, 12, 16, 20] as const;

export interface TrackerOptions {
  /** 0..1, higher follows faster and jitters more */
  smoothing?: number;
  minScore?: number;
  /** wrist travel (in video heights) within `waveWindowMs` that counts as a wave */
  waveDistance?: number;
  waveWindowMs?: number;
  /** stay open this long after the last movement */
  holdMs?: number;
  /** keep a slot alive this long when the model loses the hand for a moment */
  slotMissMs?: number;
}

const DEF: Required<TrackerOptions> = { smoothing: 0.6, minScore: 0.35, waveDistance: 0.1, waveWindowMs: 900, holdMs: 2500, slotMissMs: 350 };

interface Slot {
  id: number;
  pts: Pt3[];
  rawWrist: [number, number];
  lastSeen: number;
  speed: number;
  history: Array<{ t: number; x: number; y: number }>;
  label: string;
  score: number;
  open: boolean;
}

const dist = (a: Pt3, b: Pt3) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** An open hand: at least three of index/middle/ring/pinky are stretched (tip farther from the wrist than the middle joint). */
export function isOpenPalm(pts: Pt3[]): boolean {
  let ext = 0;
  for (const f of FINGERS.slice(1)) {
    if (dist(pts[f[3]]!, pts[0]!) > dist(pts[f[1]]!, pts[0]!) * 1.1) ext++;
  }
  return ext >= 3;
}

export class HandTracker {
  private o: Required<TrackerOptions>;
  private slots: Slot[] = [];
  private activeUntil = -Infinity;
  private manual = false;
  private auto = true;
  private active = false;

  constructor(opts: TrackerOptions = {}) {
    this.o = { ...DEF, ...opts };
  }

  /** false = a wave never opens the stage by itself (manual mode). */
  setAuto(on: boolean) {
    this.auto = on;
    if (!on) this.activeUntil = -Infinity;
  }
  /** The owner opened the stage by hand (button): it stays open until closed. */
  setManual(on: boolean) {
    this.manual = on;
    if (!on) this.activeUntil = -Infinity;
  }
  /** Close now (Esc / close button). */
  dismiss() {
    this.manual = false;
    this.activeUntil = -Infinity;
    this.active = false;
  }
  reset() {
    this.slots = [];
    this.dismiss();
  }

  update(frame: HandFrame): HandView {
    const t = frame.ts;
    const aspect = frame.width > 0 && frame.height > 0 ? frame.width / frame.height : 4 / 3;
    const parsed = this.parse(frame);

    // match detections to slots by wrist distance, closest pairs first (keeps "hand 1" and "hand 2" stable between frames;
    // a fast wave can move a wrist a long way between two frames, so the radius is generous)
    const cand: Array<{ di: number; s: Slot; d: number }> = [];
    parsed.forEach((det, di) => {
      for (const s of this.slots) cand.push({ di, s, d: Math.hypot((s.rawWrist[0] - det.pts[0]![0]) * aspect, s.rawWrist[1] - det.pts[0]![1]) });
    });
    cand.sort((x, y) => x.d - y.d);
    const usedSlot = new Set<number>();
    const matched = new Map<number, Slot>();
    for (const c of cand) {
      if (c.d > 0.7 || usedSlot.has(c.s.id) || matched.has(c.di)) continue;
      usedSlot.add(c.s.id);
      matched.set(c.di, c.s);
    }
    const pairs = parsed.map((det, di) => ({ det, slot: matched.get(di) ?? null }));
    for (const { det, slot } of pairs) {
      let s = slot;
      if (!s) {
        if (this.slots.length >= 2) continue;
        const free = [0, 1].find((i) => !this.slots.some((x) => x.id === i))!;
        s = { id: free, pts: det.pts.map((p) => [...p] as Pt3), rawWrist: [det.pts[0]![0], det.pts[0]![1]], lastSeen: t, speed: 0, history: [], label: det.label, score: det.score, open: false };
        this.slots.push(s);
      } else {
        const dt = Math.max(0.001, (t - s.lastSeen) / 1000);
        const moved = Math.hypot((det.pts[0]![0] - s.rawWrist[0]) * aspect, det.pts[0]![1] - s.rawWrist[1]);
        s.speed = s.speed * 0.5 + (moved / dt) * 0.5;
        const a = this.o.smoothing;
        s.pts = s.pts.map((p, i) => [p[0] + (det.pts[i]![0] - p[0]) * a, p[1] + (det.pts[i]![1] - p[1]) * a, p[2] + (det.pts[i]![2] - p[2]) * a] as Pt3);
        s.rawWrist = [det.pts[0]![0], det.pts[0]![1]];
        s.lastSeen = t;
        s.label = det.label;
        s.score = det.score;
      }
      s.open = isOpenPalm(det.pts);
      s.history.push({ t, x: det.pts[0]![0] * aspect, y: det.pts[0]![1] });
      s.history = s.history.filter((h) => t - h.t <= this.o.waveWindowMs);
    }
    this.slots = this.slots.filter((s) => t - s.lastSeen <= this.o.slotMissMs);

    // wave: an open hand whose wrist travelled far enough within the window
    let waving = false;
    for (const s of this.slots) {
      if (!s.open || t - s.lastSeen > 150) continue;
      let maxD = 0;
      for (let i = 0; i < s.history.length; i++) for (let j = i + 1; j < s.history.length; j++) maxD = Math.max(maxD, Math.hypot(s.history[i]!.x - s.history[j]!.x, s.history[i]!.y - s.history[j]!.y));
      if (maxD >= this.o.waveDistance) waving = true;
    }
    const visible = this.slots.filter((s) => t - s.lastSeen <= 150);
    if (waving) this.activeUntil = t + this.o.holdMs;
    // once open, any clearly moving hand keeps it open
    else if (this.active && visible.some((s) => s.speed >= 0.05)) this.activeUntil = t + this.o.holdMs;
    this.active = this.manual || (this.auto && t < this.activeUntil);

    return {
      active: this.active,
      waving,
      hands: visible.map((s) => ({ slot: s.id, label: s.label, score: s.score, pts: s.pts, speed: s.speed, openPalm: s.open })),
    };
  }

  /** No frame arrived (camera off / nothing detected for a while): lets the hold timer run out. */
  idle(ts: number): HandView {
    return this.update({ ts, width: 640, height: 480, hands: [] });
  }

  private parse(frame: HandFrame) {
    const out: Array<{ label: string; score: number; pts: Pt3[] }> = [];
    const w = frame.width || 640;
    const h = frame.height || 480;
    for (const raw of frame.hands) {
      if (raw.score < this.o.minScore || !Array.isArray(raw.keypoints) || raw.keypoints.length !== 21) continue;
      const pts: Pt3[] = [];
      let ok = true;
      for (const k of raw.keypoints) {
        if (!Array.isArray(k) || k.length < 2 || !Number.isFinite(k[0]) || !Number.isFinite(k[1])) {
          ok = false;
          break;
        }
        pts.push([1 - k[0]! / w, k[1]! / h, (k[2] ?? 0) / w]);
      }
      if (ok) out.push({ label: raw.label, score: raw.score, pts });
    }
    return out.slice(0, 2);
  }
}

// ---------------------------------------------------------------------------- drawing geometry

export interface Projected {
  /** stage pixels */
  pts: Array<[number, number]>;
  /** stage pixels of one video-height: scales line widths */
  unit: number;
}

/**
 * Maps a tracked hand onto the stage. The wrist follows your real wrist across the whole screen; the hand SHAPE is drawn
 * `scale` times larger than in the camera (so it reads as big AI hands) without being stretched.
 */
export function projectHand(h: TrackedHand, stageW: number, stageH: number, aspect = 4 / 3, scale = 1.7): Projected {
  const unit = stageH * scale;
  const wx = h.pts[0]![0];
  const wy = h.pts[0]![1];
  const pts = h.pts.map((p) => {
    const dx = (p[0] - wx) * aspect;
    const dy = p[1] - wy;
    return [wx * stageW + dx * unit, wy * stageH + dy * unit] as [number, number];
  });
  // keep the whole hand on the stage: shift it back if it would leave the screen
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const m = 24;
  let sx = 0;
  let sy = 0;
  if (Math.min(...xs) < m) sx = m - Math.min(...xs);
  else if (Math.max(...xs) > stageW - m) sx = stageW - m - Math.max(...xs);
  if (Math.min(...ys) < m) sy = m - Math.min(...ys);
  else if (Math.max(...ys) > stageH - m) sy = stageH - m - Math.max(...ys);
  return { pts: pts.map((p) => [p[0] + sx, p[1] + sy] as [number, number]), unit };
}
