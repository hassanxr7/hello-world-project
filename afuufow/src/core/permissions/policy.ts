import type { AssuranceLevel, PermissionGrant, ToolRisk } from '../../shared/types';
import { ASSURANCE_ORDER } from '../../shared/types';
import type { Settings } from '../config/settings';

export interface ToolMeta {
  name: string;
  risk: ToolRisk;
  /** true if the tool only observes (no side effects). */
  readOnly: boolean;
  /** Stable permission key, e.g. "apps.open", "messaging.send". */
  permissionKey: string;
}

export interface PolicyContext {
  settings: Settings;
  assurance: AssuranceLevel;
  /** Camera/voice identification is in use, so the owner's identity is actually being checked. */
  identityChannelsEnabled: boolean;
  /** An unrecognised person is in front of the camera and the owner is not verified. */
  visitorPresent: boolean;
  /** More than one person visible: private details must not be read aloud. */
  otherPeoplePresent: boolean;
  /** Untrusted content (web page, message, document, screen text) is part of the current task's context. */
  tainted: boolean;
  grants: PermissionGrant[];
  now: number;
}

export interface ToolRequest {
  meta: ToolMeta;
  /** Extra facts the tool can supply for its own decision. */
  facts?: {
    /** messaging.send: the owner's command said "send" explicitly */
    explicitSend?: boolean;
    contactId?: string;
    contactFastSend?: boolean;
    /** the owner (not a third party) asked for private details to be spoken aloud */
    ownerRequestedAloud?: boolean;
  };
  /** The call came from a plan produced by the AI planner (not a deterministic owner command). */
  fromPlanner?: boolean;
}

export type Decision =
  | { kind: 'allow'; by: 'auto' | 'standing-permission' }
  | { kind: 'confirm'; so: string; en: string; strong?: boolean; screenOnly?: boolean }
  | { kind: 'auth'; level: 'presence' | 'strong'; so: string; en: string }
  | { kind: 'deny'; so: string; en: string };

const deny = (so: string, en: string): Decision => ({ kind: 'deny', so, en });

export function hasGrant(ctx: PolicyContext, key: string): boolean {
  return ctx.grants.some((g) => g.key === key && (!g.expiresAt || g.expiresAt > ctx.now));
}

function decideByRisk(ctx: PolicyContext, req: ToolRequest): Decision {
  const { meta } = req;
  const lvl = ASSURANCE_ORDER[ctx.assurance];

  if (meta.risk === 'forbidden') {
    return deny('Tan ma samayn karo; waa mamnuuc.', 'This action is forbidden and cannot be performed.');
  }

  // A visitor in front of the laptop gets no access to owner capabilities.
  if (ctx.visitorPresent && lvl < ASSURANCE_ORDER.strong) {
    return deny(
      'Qof aan la aqoonsan ayaa joogo; amarrada Boss-ka lama fulin karo ilaa laga xaqiijiyo.',
      'An unrecognised person is present; owner commands are blocked until the owner is verified.',
    );
  }

  switch (meta.risk) {
    case 'routine':
      // Opening apps, playing media, searching: executes promptly (owner's standing expectation).
      return { kind: 'allow', by: 'auto' };

    case 'messaging': {
      const f = req.facts ?? {};
      const needPresence = ctx.identityChannelsEnabled && ctx.settings.permissions.messaging.requirePresenceToSend;
      if (meta.permissionKey === 'messaging.send') {
        const fastOk = ctx.settings.permissions.messaging.mode === 'fast' && f.contactFastSend && f.contactId !== undefined && hasGrant(ctx, `messaging.fastSend:${f.contactId}`);
        // identity first: a confirmation must never replace the presence requirement
        if (needPresence && lvl < ASSURANCE_ORDER.presence) {
          return { kind: 'auth', level: 'presence', so: 'Fadlan kamaradda fiiri si aan u xaqiijiyo inaad adigu tahay.', en: 'Please look at the camera so I can confirm it is you.' };
        }
        if (!f.explicitSend && !fastOk) {
          return { kind: 'confirm', so: 'Ma dirayaa fariintan?', en: 'Shall I send this message?' };
        }
        return { kind: 'allow', by: f.explicitSend ? 'auto' : 'standing-permission' };
      }
      // drafting / opening a chat: harmless, nothing leaves the laptop
      return { kind: 'allow', by: 'auto' };
    }

    case 'private': {
      const f = req.facts ?? {};
      if (lvl < ASSURANCE_ORDER.presence) {
        return { kind: 'auth', level: 'presence', so: 'Macluumaadkan waa gaar; marka hore aqoonsi ii sii.', en: 'This is private; identity verification is required first.' };
      }
      if (ctx.otherPeoplePresent && !f.ownerRequestedAloud) {
        return { kind: 'confirm', so: 'Qof kale ayaa jooga; ma tuso shaashadda kaliya?', en: 'Someone else is present; show on screen only?', screenOnly: true };
      }
      return { kind: 'allow', by: 'auto' };
    }

    case 'sensitive': {
      if (lvl < ASSURANCE_ORDER.strong) {
        return { kind: 'auth', level: 'strong', so: 'Tallaabadan waxay u baahan tahay Windows Hello ama PIN-kaaga.', en: 'This needs Windows Hello or your PIN.' };
      }
      // Sensitive actions are never covered by a standing permission: always an explicit yes.
      return { kind: 'confirm', so: 'Ma hubtaa inaad rabto tallaabadan?', en: 'Are you sure you want to do this?', strong: true };
    }
  }
}

/**
 * Final decision. Untrusted content in the task's context (web page, message, document, screen text) can never
 * trigger a side effect by itself: after the risk rules pass, any non-read-only action additionally needs the owner's yes.
 * (Auth and deny results from the risk rules are returned unchanged, so a taint confirmation can never replace them.)
 */
export function decide(ctx: PolicyContext, req: ToolRequest): Decision {
  const base = decideByRisk(ctx, req);
  if (base.kind === 'allow' && ctx.tainted && !req.meta.readOnly) {
    return {
      kind: 'confirm',
      so: 'Waxaan akhriyay qoraal ka yimid meel kale; ma xaqiijin kartaa inaad rabto tallaabadan?',
      en: 'Content from an outside source is involved; please confirm you want this action.',
    };
  }
  return base;
}
