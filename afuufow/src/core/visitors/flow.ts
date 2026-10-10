import { type OwnerNames, VISITOR_AUDIO_DISCLOSURE, VISITOR_DECLINED_ACK, VISITOR_SNAPSHOT_DISCLOSURE, VISITOR_THANKS, visitorConsentPhrase, visitorIntroPhrase } from '../../shared/phrases';
import type { Settings } from '../config/settings';
import { AbortError, throwIfAborted, uid } from '../util';
import { type ConsentStatus, type VisitorEvent, type VisitorLog } from './log';
import { extractSelfReportedName, isDecline } from './selfreport';

export interface VisitorIO {
  /** Speaks and resolves when playback has finished (so nothing is recorded before the notice ends). */
  speak(text: string, signal: AbortSignal): Promise<void>;
  /** Listens for the visitor's reply. null = nothing was said within the window. */
  listen(timeoutMs: number, signal: AbortSignal): Promise<{ text: string; audio?: Buffer } | null>;
  /** One still frame from the camera, or null if unavailable. */
  snapshot(): Promise<Buffer | null>;
}

export interface VisitorFlowInput {
  owner: OwnerNames;
  settings: Settings;
  recognitionConfidence: number | null;
  recognitionState: 'unknown' | 'uncertain';
}

/**
 * The unknown-person interaction.
 * Guarantees:
 *  - the consent notice (and every extra disclosure for enabled options) is fully spoken BEFORE listening starts;
 *  - nothing the visitor says is stored if they decline, say nothing, or the owner returns mid-flow;
 *  - media (snapshot/audio) is stored only if the matching option is enabled AND was disclosed;
 *  - nothing is inferred from appearance; name/permission claims are stored as self-reported text.
 */
export async function runVisitorFlow(io: VisitorIO, log: VisitorLog, inp: VisitorFlowInput, signal: AbortSignal): Promise<VisitorEvent> {
  const { settings, owner } = inp;
  const disclosures: Array<'snapshot' | 'audio'> = [];
  let notice = visitorConsentPhrase(owner);
  if (settings.visitors.snapshot === 'disclosed') {
    notice += ' ' + VISITOR_SNAPSHOT_DISCLOSURE;
    disclosures.push('snapshot');
  }
  if (settings.visitors.saveAudio) {
    notice += ' ' + VISITOR_AUDIO_DISCLOSURE;
    disclosures.push('audio');
  }

  const base = {
    at: Date.now(),
    recognitionState: inp.recognitionState,
    recognitionConfidence: inp.recognitionConfidence,
    selfReportedName: null as string | null,
    selfReportedGender: null as string | null,
    transcript: null as string | null,
    consent: 'not_asked' as ConsentStatus,
    noticeSpokenAt: null as number | null,
    disclosures: [] as Array<'snapshot' | 'audio'>,
    snapshotId: null as string | null,
    audioId: null as string | null,
  };

  try {
    await io.speak(visitorIntroPhrase(owner), signal);
    await io.speak(notice, signal);
    base.noticeSpokenAt = Date.now();
    base.disclosures = disclosures;
    throwIfAborted(signal);

    const reply = await io.listen(settings.visitors.responseWindowSec * 1000, signal);
    throwIfAborted(signal);

    if (!reply || !reply.text.trim()) {
      base.consent = 'no_response';
      return log.add(base);
    }
    if (isDecline(reply.text)) {
      base.consent = 'declined';
      // deliberately do NOT store their words or any media
      await io.speak(VISITOR_DECLINED_ACK, signal).catch(() => undefined);
      return log.add(base);
    }

    base.consent = 'responded_after_notice';
    base.transcript = reply.text.trim();
    base.selfReportedName = extractSelfReportedName(reply.text);

    const id = uid('m_');
    if (disclosures.includes('snapshot')) {
      const img = await io.snapshot();
      if (img) {
        await log.blobs.put(id + '_img', img);
        base.snapshotId = id + '_img';
      }
    }
    if (disclosures.includes('audio') && reply.audio) {
      await log.blobs.put(id + '_aud', reply.audio);
      base.audioId = id + '_aud';
    }
    const ev = log.add(base);
    await io.speak(VISITOR_THANKS, signal).catch(() => undefined);
    return ev;
  } catch (e) {
    if (e instanceof AbortError || (e as Error).name === 'AbortError') {
      // interrupted (owner returned / paused / app exit): record the fact only, never the words
      base.consent = base.noticeSpokenAt ? 'interrupted' : 'not_asked';
      base.transcript = null;
      base.selfReportedName = null;
      return log.add(base);
    }
    throw e;
  }
}

/** Prevents re-questioning the same person: one flow per cooldown unless they left and a long gap passed. */
export class VisitorGate {
  private until = 0;
  constructor(private now: () => number = Date.now) {}
  canStart(cooldownMin: number): boolean {
    return this.now() >= this.until;
  }
  started(cooldownMin: number) {
    this.until = this.now() + cooldownMin * 60_000;
  }
  reset() {
    this.until = 0;
  }
}
