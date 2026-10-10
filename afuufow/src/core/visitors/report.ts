import type { OwnerNames } from '../../shared/phrases';
import type { SessionEvent, VisitorEvent } from './log';

function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dayWord(ts: number, now: number): string {
  const d = new Date(ts);
  const n = new Date(now);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(n) - start(d)) / 86_400_000);
  if (diff === 0) return 'maanta';
  if (diff === 1) return 'shalay';
  return d.toISOString().slice(0, 10);
}

/**
 * Spoken summary of one visitor event. Third-person pronouns are used ONLY if the visitor
 * stated their own gender; otherwise neutral wording is used (no inference from appearance).
 */
export function describeEvent(ev: VisitorEvent, now: number): string {
  const when = `${dayWord(ev.at, now)} saacadda ${hhmm(ev.at)}`;
  const head = `qof aanan aqoonsan ayaa kamaradda ka muuqday ${when}.`;
  const gender = ev.selfReportedGender?.toLowerCase();
  const male = gender === 'male' || gender === 'nin';
  const female = gender === 'female' || gender === 'gabadh';

  if (ev.consent === 'declined') return `${head} Qofkaas jawaab bixin ma doonin, markaa wax kale lama kaydin.`;
  if (ev.consent === 'no_response' || ev.consent === 'interrupted' || ev.consent === 'not_asked') {
    return `${head} Jawaab lama helin.`;
  }
  const name = ev.selfReportedName;
  const said = ev.transcript ?? '';
  if (male) return `${head} Wuxuu magaciisa ku sheegay ${name ?? 'wax magac ah ma sheegin'}, wuxuuna yiri: ‘${said}’.`;
  if (female) return `${head} Waxay magaceeda ku sheegtay ${name ?? 'wax magac ah ma sheegin'}, waxayna tidhi: ‘${said}’.`;
  return `${head} Magaca la sheegay waa ${name ?? 'lama sheegin'}; jawaabta la bixiyayna waxay ahayd: ‘${said}’.`;
}

export function describeSession(events: SessionEvent[]): string {
  if (events.length === 0) return '';
  const e = events[0]!;
  const label = e.kind === 'unlock' ? 'furitaan (unlock)' : e.kind === 'signin' ? 'gal (sign-in)' : e.kind === 'resume' ? 'soo noqosho hurdada (resume)' : 'dhacdo galitaan';
  return `Sidoo kale, Windows wuxuu diiwaangeliyay ${label} saacadda ${hhmm(e.at)}. Kamarada iyo Windows waa laba diiwaan oo kala duwan; ma xaqiijin karo in qofka kamaradda ka muuqday uu sababay.`;
}

export interface ReportInput {
  owner: OwnerNames;
  pending: VisitorEvent[];
  sessionNear: (at: number) => SessionEvent[];
  now: number;
  /** Owner identity verified to at least "presence" */
  verified: boolean;
  /** another person is visible next to the owner */
  othersPresent: boolean;
  ownerRequestedAloud: boolean;
}

export interface Report {
  /** What may be spoken now. */
  spoken: string;
  /** Full details are shown on screen only when true. */
  screenOnly: boolean;
  eventIds: string[];
}

/** Builds the report the assistant may speak. Private details are withheld unless identity and privacy conditions hold. */
export function buildVisitorReport(i: ReportInput): Report | null {
  if (i.pending.length === 0) return null;
  const ids = i.pending.map((e) => e.id);
  if (!i.verified) {
    return { spoken: '', screenOnly: true, eventIds: ids }; // nothing is disclosed until identity is verified
  }
  if (i.othersPresent && !i.ownerRequestedAloud) {
    return {
      spoken: `${i.owner.nickname}, waxaa jira ${i.pending.length} ogeysiis oo ku saabsan booqdayaal. Qof kale ayaa joogo, markaa ma akhrin; waxaan ku tusayaa shaashadda marka aad rabto.`,
      screenOnly: true,
      eventIds: ids,
    };
  }
  const parts: string[] = [];
  const first = i.pending[0]!;
  if (i.pending.length > 1) parts.push(`${i.owner.nickname}, ${i.pending.length} jeer ayaa qof aan aqoonsanayn kamaradda ka muuqday. Kan ugu horreeyay:`);
  else parts.push(`${i.owner.nickname},`);
  parts.push(describeEvent(first, i.now));
  const sess = describeSession(i.sessionNear(first.at));
  if (sess) parts.push(sess);
  parts.push('Ma la socotaa? Ma rabtaa inaan ku tuso diiwaanka?');
  return { spoken: parts.join(' '), screenOnly: false, eventIds: ids };
}
