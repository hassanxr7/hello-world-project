import { ASSURANCE_ORDER, type AssuranceLevel } from '../../shared/types';

export interface AssuranceConfig {
  presenceTtlMs: number;
  voiceTtlMs: number;
  strongTtlMs: number;
}

/**
 * Tracks how well the current person has been identified as the owner.
 *  - voice    : speaker recognition matched. NEVER enough for private/sensitive actions (a recording could replay it).
 *  - presence : the camera recently recognised the owner's live face and no unknown face has replaced it.
 *  - strong   : Windows Hello or the owner PIN was verified recently.
 */
export class AssuranceManager {
  private faceAt = -Infinity;
  private voiceAt = -Infinity;
  private strongAt = -Infinity;
  private unknownAt = -Infinity;
  private strongConsumed = false;

  constructor(
    private cfg: AssuranceConfig,
    private now: () => number = Date.now,
  ) {}

  configure(cfg: Partial<AssuranceConfig>) {
    this.cfg = { ...this.cfg, ...cfg };
  }

  ownerFaceSeen(at = this.now()) {
    this.faceAt = at;
  }
  /** An unrecognised face appeared: owner presence is no longer assured until the owner is seen again. */
  unknownFaceSeen(at = this.now()) {
    this.unknownAt = at;
    if (this.unknownAt >= this.faceAt) this.faceAt = -Infinity;
  }
  ownerVoiceMatched(at = this.now()) {
    this.voiceAt = at;
  }
  strongVerified(at = this.now()) {
    this.strongAt = at;
    this.strongConsumed = false;
  }
  /** Sensitive one-shot actions consume the strong verification. */
  consumeStrong() {
    this.strongConsumed = true;
  }
  ownerLeft() {
    this.faceAt = -Infinity;
    this.voiceAt = -Infinity;
    this.strongAt = -Infinity;
  }
  reset() {
    this.faceAt = this.voiceAt = this.strongAt = this.unknownAt = -Infinity;
  }

  level(): AssuranceLevel {
    const t = this.now();
    if (!this.strongConsumed && t - this.strongAt <= this.cfg.strongTtlMs) return 'strong';
    if (t - this.faceAt <= this.cfg.presenceTtlMs) return 'presence';
    if (t - this.voiceAt <= this.cfg.voiceTtlMs) return 'voice';
    return 'none';
  }

  atLeast(l: AssuranceLevel): boolean {
    return ASSURANCE_ORDER[this.level()] >= ASSURANCE_ORDER[l];
  }
}
