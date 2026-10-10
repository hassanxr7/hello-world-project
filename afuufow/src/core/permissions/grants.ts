import * as path from 'node:path';
import type { PermissionGrant } from '../../shared/types';
import { type KeyProvider, EncryptedJsonFile } from '../storage/encrypted';
import { uid } from '../util';

interface Doc {
  version: 1;
  grants: PermissionGrant[];
}

/** Standing permissions the owner can see and revoke at any time. */
export class GrantStore {
  private file: EncryptedJsonFile<Doc>;
  constructor(dir: string, keys: KeyProvider) {
    this.file = new EncryptedJsonFile<Doc>(path.join(dir, 'grants.afu'), keys, () => ({ version: 1, grants: [] }));
  }
  async load() {
    await this.file.load();
  }
  flush() {
    return this.file.flush();
  }
  list(now = Date.now()): PermissionGrant[] {
    return this.file.data.grants.filter((g) => !g.expiresAt || g.expiresAt > now);
  }
  add(key: string, opts: { note?: string; expiresAt?: number } = {}): PermissionGrant {
    const existing = this.file.data.grants.find((g) => g.key === key);
    if (existing) return existing;
    const g: PermissionGrant = { id: uid('g_'), key, createdAt: Date.now(), ...opts };
    this.file.update((d) => d.grants.push(g));
    return g;
  }
  revoke(id: string) {
    this.file.update((d) => {
      d.grants = d.grants.filter((g) => g.id !== id);
    });
  }
  revokeKey(key: string) {
    this.file.update((d) => {
      d.grants = d.grants.filter((g) => g.key !== key);
    });
  }
  revokeAll() {
    this.file.update((d) => {
      d.grants = [];
    });
  }
  setFastSend(contactId: string, on: boolean) {
    const key = `messaging.fastSend:${contactId}`;
    if (on) this.add(key, { note: 'Fast-send enabled for approved contact' });
    else this.revokeKey(key);
  }
}
