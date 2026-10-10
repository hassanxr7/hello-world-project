import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/core/config/settings';
import { type PolicyContext, type ToolMeta, decide } from '../src/core/permissions/policy';
import { AssuranceManager } from '../src/core/permissions/assurance';

const ctx = (o: Partial<PolicyContext> = {}): PolicyContext => ({
  settings: defaultSettings(), assurance: 'none', identityChannelsEnabled: false, visitorPresent: false, otherPeoplePresent: false, tainted: false, grants: [], now: 1000, ...o,
});
const meta = (risk: ToolMeta['risk'], key = 'x', readOnly = false): ToolMeta => ({ name: key, risk, readOnly, permissionKey: key });

describe('permission policy', () => {
  it('routine actions run promptly', () => {
    expect(decide(ctx(), { meta: meta('routine', 'apps.open') })).toEqual({ kind: 'allow', by: 'auto' });
  });
  it('forbidden tools are always denied, even with strong auth', () => {
    expect(decide(ctx({ assurance: 'strong' }), { meta: meta('forbidden', 'payments.make') }).kind).toBe('deny');
  });
  it('a visitor in front of the laptop blocks every owner action', () => {
    expect(decide(ctx({ visitorPresent: true, assurance: 'presence' }), { meta: meta('routine') }).kind).toBe('deny');
    expect(decide(ctx({ visitorPresent: true }), { meta: meta('routine', 'x', true) }).kind).toBe('deny');
  });
  it('sensitive actions need strong auth, then an explicit yes; presence alone is not enough', () => {
    expect(decide(ctx({ assurance: 'presence' }), { meta: meta('sensitive', 'files.recycle') })).toMatchObject({ kind: 'auth', level: 'strong' });
    expect(decide(ctx({ assurance: 'voice' }), { meta: meta('sensitive') })).toMatchObject({ kind: 'auth', level: 'strong' });
    expect(decide(ctx({ assurance: 'strong' }), { meta: meta('sensitive') })).toMatchObject({ kind: 'confirm', strong: true });
  });
  it('a standing grant never covers a sensitive action', () => {
    const grants = [{ id: 'g', key: 'files.recycle', createdAt: 0 }];
    expect(decide(ctx({ assurance: 'strong', grants }), { meta: meta('sensitive', 'files.recycle') }).kind).toBe('confirm');
  });
  it('voice recognition alone never reveals private data', () => {
    expect(decide(ctx({ assurance: 'voice' }), { meta: meta('private', 'screen.read', true) }).kind).toBe('auth');
    expect(decide(ctx({ assurance: 'presence' }), { meta: meta('private', 'screen.read', true) }).kind).toBe('allow');
  });
  it('private details are not read aloud when another person is present', () => {
    expect(decide(ctx({ assurance: 'presence', otherPeoplePresent: true }), { meta: meta('private', 'p', true) }).kind).toBe('confirm');
    expect(decide(ctx({ assurance: 'presence', otherPeoplePresent: true }), { meta: meta('private', 'p', true), facts: { ownerRequestedAloud: true } }).kind).toBe('allow');
  });

  describe('messaging', () => {
    const send = meta('messaging', 'messaging.send');
    it('explicit send is allowed without a second confirmation', () => {
      expect(decide(ctx(), { meta: send, facts: { explicitSend: true, contactId: 'c' } })).toEqual({ kind: 'allow', by: 'auto' });
    });
    it('non-explicit send asks once', () => {
      expect(decide(ctx(), { meta: send, facts: { explicitSend: false, contactId: 'c' } }).kind).toBe('confirm');
    });
    it('fast-send needs BOTH the global fast mode and the per-contact grant', () => {
      const s = defaultSettings();
      const grant = [{ id: 'g', key: 'messaging.fastSend:c', createdAt: 0 }];
      const facts = { explicitSend: false, contactId: 'c', contactFastSend: true };
      expect(decide(ctx({ settings: s, grants: grant }), { meta: send, facts }).kind).toBe('confirm'); // mode explicit
      s.permissions.messaging.mode = 'fast';
      expect(decide(ctx({ settings: s, grants: grant }), { meta: send, facts })).toEqual({ kind: 'allow', by: 'standing-permission' });
      expect(decide(ctx({ settings: s, grants: [] }), { meta: send, facts }).kind).toBe('confirm'); // revoked
    });
    it('revoked or expired grants stop working', () => {
      const s = defaultSettings();
      s.permissions.messaging.mode = 'fast';
      const facts = { explicitSend: false, contactId: 'c', contactFastSend: true };
      expect(decide(ctx({ settings: s, now: 5000, grants: [{ id: 'g', key: 'messaging.fastSend:c', createdAt: 0, expiresAt: 4000 }] }), { meta: send, facts }).kind).toBe('confirm');
    });
    it('sending requires presence when identity channels are on; confirmation cannot replace it', () => {
      const s = defaultSettings();
      s.camera.enabled = true;
      const base = { settings: s, identityChannelsEnabled: true };
      expect(decide(ctx({ ...base, assurance: 'none' }), { meta: send, facts: { explicitSend: true, contactId: 'c' } })).toMatchObject({ kind: 'auth', level: 'presence' });
      expect(decide(ctx({ ...base, assurance: 'none' }), { meta: send, facts: { explicitSend: false, contactId: 'c' } })).toMatchObject({ kind: 'auth', level: 'presence' });
      expect(decide(ctx({ ...base, assurance: 'presence' }), { meta: send, facts: { explicitSend: true, contactId: 'c' } }).kind).toBe('allow');
    });
  });

  describe('prompt-injection guard (untrusted content is data)', () => {
    it('side effects after reading outside content need the owner to confirm', () => {
      expect(decide(ctx({ tainted: true }), { meta: meta('routine', 'apps.open') }).kind).toBe('confirm');
      expect(decide(ctx({ tainted: true }), { meta: meta('routine', 'files.find', true) }).kind).toBe('allow');
    });
    it('a taint confirmation never substitutes for strong authentication', () => {
      expect(decide(ctx({ tainted: true, assurance: 'presence' }), { meta: meta('sensitive') })).toMatchObject({ kind: 'auth', level: 'strong' });
    });
    it('forbidden stays forbidden', () => {
      expect(decide(ctx({ tainted: true }), { meta: meta('forbidden') }).kind).toBe('deny');
    });
  });
});

describe('assurance levels', () => {
  const mk = () => {
    const c = { t: 0 };
    return { c, a: new AssuranceManager({ presenceTtlMs: 1000, voiceTtlMs: 500, strongTtlMs: 2000 }, () => c.t) };
  };
  it('voice alone gives only the "voice" level', () => {
    const { a } = mk();
    a.ownerVoiceMatched();
    expect(a.level()).toBe('voice');
    expect(a.atLeast('presence')).toBe(false);
  });
  it('face gives presence and expires', () => {
    const { a, c } = mk();
    a.ownerFaceSeen();
    expect(a.level()).toBe('presence');
    c.t = 1500;
    expect(a.level()).toBe('none');
  });
  it('strong expires and can be consumed by a one-shot action', () => {
    const { a, c } = mk();
    a.strongVerified();
    expect(a.level()).toBe('strong');
    a.consumeStrong();
    expect(a.level()).toBe('none');
    a.strongVerified();
    c.t = 2500;
    expect(a.level()).toBe('none');
  });
  it('an unknown face cancels presence until the owner is seen again', () => {
    const { a } = mk();
    a.ownerFaceSeen();
    a.unknownFaceSeen();
    expect(a.level()).toBe('none');
    a.ownerFaceSeen();
    expect(a.level()).toBe('presence');
  });
});
