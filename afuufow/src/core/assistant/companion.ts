/**
 * "Companion" behaviour: Afuufow may start a short friendly chat on its own while the owner is around,
 * and keeps listening for a reply after it speaks (no wake word needed for the answer).
 * This file is the pure decision logic so it can be unit-tested; the Assistant supplies the facts.
 */

export interface CompanionSettings {
  /** After Afuufow finishes speaking, keep the microphone open for a reply without the wake word. */
  followUp: boolean;
  followUpSec: number;
  /** Start short friendly remarks / jokes on its own. */
  proactive: boolean;
  /** Minimum quiet time (minutes) before it speaks first; grows when its remarks go unanswered. */
  minIdleMin: number;
  maxPerHour: number;
}

export interface CompanionFacts {
  now: number;
  settings: CompanionSettings;
  micOn: boolean;
  speakerOn: boolean;
  paused: boolean;
  /** Anything in progress: speaking, thinking, a task, a pending question or queued commands. */
  busy: boolean;
  visitorPresent: boolean;
  othersPresent: boolean;
  cameraOn: boolean;
  ownerSeenByCamera: boolean;
  /** Last time the owner said or typed something to Afuufow (0 = never). */
  lastOwnerAt: number;
  lastProactiveAt: number;
  /** Start times of recent proactive remarks (any age; filtered here). */
  proactiveTimes: number[];
  /** Proactive remarks since the owner last answered. */
  unanswered: number;
  snoozeUntil: number;
  /** Last time speech output failed (0 = never). Do not talk to an empty room if TTS is broken. */
  speechFailedAt: number;
}

const MIN = 60_000;
export const MAX_UNANSWERED = 3;
/** Without a camera the only evidence the owner is there is a recent interaction. */
export const RECENT_INTERACTION_MS = 20 * MIN;

export function companionDecision(f: CompanionFacts): { speak: boolean; reason: string } {
  const no = (reason: string) => ({ speak: false, reason });
  const c = f.settings;
  if (!c.proactive) return no('disabled');
  if (f.paused || !f.micOn) return no('microphone off'); // it must be able to hear the answer
  if (!f.speakerOn) return no('speaker off');
  if (f.busy) return no('busy');
  if (f.visitorPresent || f.othersPresent) return no('someone else is present');
  if (f.now < f.snoozeUntil) return no('snoozed');
  if (f.speechFailedAt && f.now - f.speechFailedAt < 30 * MIN) return no('speech output is failing');
  if (f.unanswered >= MAX_UNANSWERED) return no('owner has not answered');
  const owner = f.cameraOn ? f.ownerSeenByCamera : f.lastOwnerAt > 0 && f.now - f.lastOwnerAt < RECENT_INTERACTION_MS;
  if (!owner) return no('owner not detected');
  const quietFor = f.now - Math.max(f.lastOwnerAt, f.lastProactiveAt);
  if (quietFor < c.minIdleMin * MIN * (1 + f.unanswered)) return no('not quiet long enough');
  if (f.proactiveTimes.filter((t) => f.now - t < 60 * MIN).length >= c.maxPerHour) return no('hourly limit');
  return { speak: true, reason: 'ok' };
}
