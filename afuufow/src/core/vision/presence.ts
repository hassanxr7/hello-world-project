import type { Settings } from '../config/settings';

/** One detected face in a processed frame (embedding matching happens in the vision worker, where the model lives). */
export interface FaceObs {
  /** best similarity to the owner's enrolled templates, null if the owner is not enrolled */
  ownerSimilarity: number | null;
  /** best similarity to any "known person" template + their id */
  knownSimilarity: number | null;
  knownId?: string;
  /** 0..1 liveness/anti-spoof score from the model, null if unavailable */
  liveness: number | null;
  /** false when the face is too small/blurred/dark/angled to judge */
  qualityOk: boolean;
  qualityReason?: 'dark' | 'bright' | 'small' | 'blur' | 'angle';
}

export interface FrameObs {
  ts: number;
  faces: FaceObs[];
  /** mean luminance 0..1 of the frame */
  luminance: number;
}

export type FaceClass = 'owner' | 'known' | 'unknown' | 'uncertain' | 'possible_photo';

export const LIVENESS_MIN = 0.5;

export function classifyFace(f: FaceObs, cfg: Settings['camera']): FaceClass {
  if (!f.qualityOk) return 'uncertain';
  const sim = f.ownerSimilarity;
  if (sim !== null && sim >= cfg.matchThreshold) {
    if (cfg.requireLiveness && f.liveness !== null && f.liveness < LIVENESS_MIN) return 'possible_photo';
    return 'owner';
  }
  if (f.knownSimilarity !== null && f.knownSimilarity >= cfg.matchThreshold) return 'known';
  if (sim === null) return 'uncertain'; // owner not enrolled: cannot call anyone "unknown owner"
  if (sim <= cfg.unknownCeiling) return 'unknown';
  return 'uncertain';
}

export type PresenceEvent =
  | { type: 'owner_arrived'; at: number; similarity: number; returning: boolean }
  | { type: 'owner_seen'; at: number; similarity: number }
  | { type: 'owner_left'; at: number }
  | { type: 'unknown_arrived'; at: number; bestOwnerSimilarity: number | null }
  | { type: 'unknown_left'; at: number }
  | { type: 'uncertain'; at: number; reason: string }
  | { type: 'possible_photo'; at: number }
  | { type: 'lighting'; at: number; state: 'dark' | 'bright' | 'ok' };

export interface PresenceSnapshot {
  ownerPresent: boolean;
  unknownPresent: boolean;
  /** an unknown face is present and the owner is not */
  visitorPresent: boolean;
  /** someone other than the owner is visible while the owner is present */
  othersWithOwner: boolean;
  faceCount: number;
  uncertain: boolean;
  lighting: 'dark' | 'bright' | 'ok';
}

/**
 * Debounced presence state machine. A transition requires `stableFrames` consecutive frames that agree,
 * so single noisy frames never greet or trigger the visitor flow.
 */
export class PresenceTracker {
  private cfg: Settings['camera'];
  private ownerRun = 0;
  private unknownRun = 0;
  private lastOwnerAt = 0;
  private ownerPresent = false;
  private unknownPresent = false;
  private lastUnknownAt = 0;
  private lastOwnerSim = 0;
  private lastUncertainEmit = -Infinity;
  private lastPhotoEmit = -Infinity;
  private lighting: 'dark' | 'bright' | 'ok' = 'ok';
  private snap: PresenceSnapshot = { ownerPresent: false, unknownPresent: false, visitorPresent: false, othersWithOwner: false, faceCount: 0, uncertain: false, lighting: 'ok' };
  private everSeenOwner = false;

  constructor(cfg: Settings['camera']) {
    this.cfg = cfg;
  }
  configure(cfg: Settings['camera']) {
    this.cfg = cfg;
  }
  get snapshot(): PresenceSnapshot {
    return this.snap;
  }
  reset() {
    this.ownerRun = this.unknownRun = 0;
    this.ownerPresent = this.unknownPresent = false;
    this.lastOwnerAt = 0;
    this.snap = { ownerPresent: false, unknownPresent: false, visitorPresent: false, othersWithOwner: false, faceCount: 0, uncertain: false, lighting: 'ok' };
  }

  push(frame: FrameObs): PresenceEvent[] {
    const out: PresenceEvent[] = [];
    const cls = frame.faces.map((f) => classifyFace(f, this.cfg));
    const t = frame.ts;

    const lighting = frame.luminance < 0.12 ? 'dark' : frame.luminance > 0.92 ? 'bright' : 'ok';
    if (lighting !== this.lighting) {
      this.lighting = lighting;
      out.push({ type: 'lighting', at: t, state: lighting });
    }

    const hasOwner = cls.includes('owner');
    const hasUnknown = cls.includes('unknown');
    const hasUncertain = cls.includes('uncertain');
    const hasPhoto = cls.includes('possible_photo');

    // ---- owner
    if (hasOwner) {
      this.ownerRun++;
      this.lastOwnerAt = t;
      const best = Math.max(...frame.faces.filter((_, i) => cls[i] === 'owner').map((f) => f.ownerSimilarity ?? 0));
      this.lastOwnerSim = best;
      if (this.ownerRun >= this.cfg.stableFrames) {
        if (!this.ownerPresent) {
          this.ownerPresent = true;
          out.push({ type: 'owner_arrived', at: t, similarity: best, returning: this.everSeenOwner });
          this.everSeenOwner = true;
        } else {
          out.push({ type: 'owner_seen', at: t, similarity: best });
        }
      }
    } else {
      this.ownerRun = 0;
      if (this.ownerPresent && t - this.lastOwnerAt >= this.cfg.leaveAfterSec * 1000) {
        this.ownerPresent = false;
        out.push({ type: 'owner_left', at: t });
      }
    }

    // ---- unknown (only meaningful when the owner is not in frame)
    if (hasUnknown && !hasOwner && !this.ownerPresent) {
      this.unknownRun++;
      this.lastUnknownAt = t;
      if (this.unknownRun >= this.cfg.stableFrames && !this.unknownPresent) {
        this.unknownPresent = true;
        const sims = frame.faces.map((f) => f.ownerSimilarity).filter((x): x is number => x !== null);
        out.push({ type: 'unknown_arrived', at: t, bestOwnerSimilarity: sims.length ? Math.max(...sims) : null });
      }
    } else if (!hasUnknown) {
      this.unknownRun = 0;
      if (this.unknownPresent && t - this.lastUnknownAt >= 10_000) {
        this.unknownPresent = false;
        out.push({ type: 'unknown_left', at: t });
      }
    }
    // an unknown face next to the owner is "other person present", not a visitor event
    const othersWithOwner = (hasOwner || this.ownerPresent) && (hasUnknown || cls.includes('known') || frame.faces.length > 1);

    // ---- honest uncertainty & anti-spoof notices (rate limited)
    if (hasPhoto && t - this.lastPhotoEmit > 30_000) {
      this.lastPhotoEmit = t;
      out.push({ type: 'possible_photo', at: t });
    }
    if (!hasOwner && !hasUnknown && hasUncertain && t - this.lastUncertainEmit > 30_000) {
      this.lastUncertainEmit = t;
      const reason = frame.faces.find((f) => !f.qualityOk)?.qualityReason ?? 'similarity between thresholds';
      out.push({ type: 'uncertain', at: t, reason });
    }

    this.snap = {
      ownerPresent: this.ownerPresent,
      unknownPresent: this.unknownPresent,
      visitorPresent: this.unknownPresent && !this.ownerPresent,
      othersWithOwner,
      faceCount: frame.faces.length,
      uncertain: hasUncertain && !hasOwner,
      lighting: this.lighting,
    };
    return out;
  }
}

/** Decides when a spoken greeting is appropriate. */
export class GreetingPolicy {
  private lastGreetAt = 0;
  constructor(
    private cfg: () => { faceCooldownMs: number; activationCooldownMs: number },
    private now: () => number = Date.now,
  ) {}
  /** The camera recognised the owner (arrival or return). */
  shouldGreetOnFace(): boolean {
    return this.now() - this.lastGreetAt >= this.cfg().faceCooldownMs;
  }
  /** The owner said the wake word / pressed push-to-talk. */
  shouldGreetOnActivation(): boolean {
    return this.now() - this.lastGreetAt >= this.cfg().activationCooldownMs;
  }
  markGreeted() {
    this.lastGreetAt = this.now();
  }
}
