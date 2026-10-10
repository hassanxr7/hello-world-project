import { type KeyProvider, EncryptedJsonFile } from '../storage/encrypted';
import { type OwnerNames, DEFAULT_OWNER } from '../../shared/phrases';
import type { ChatTurn, Contact, FolderEntry } from '../../shared/types';
import { uid } from '../util';
import * as path from 'node:path';

export type FactTrust = 'owner' | 'unverified';

export interface MemoryFact {
  id: string;
  text: string;
  /** 'owner' = stated/approved by the verified owner. 'unverified' = anything else; never used as owner truth. */
  trust: FactTrust;
  speaker?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryDoc {
  version: 1;
  profile: OwnerNames & { language: 'so' | 'en'; voiceNote?: string; enrolledAt?: number };
  facts: MemoryFact[];
  preferences: Record<string, string>;
  favorites: { apps: string[]; folders: FolderEntry[] };
  contacts: Contact[];
  history: ChatTurn[];
}

export function emptyMemory(): MemoryDoc {
  return {
    version: 1,
    profile: { ...DEFAULT_OWNER, language: 'so' },
    facts: [],
    preferences: {},
    favorites: { apps: [], folders: [] },
    contacts: [],
    history: [],
  };
}

export class MemoryStore {
  private file: EncryptedJsonFile<MemoryDoc>;
  constructor(dir: string, keys: KeyProvider) {
    this.file = new EncryptedJsonFile<MemoryDoc>(path.join(dir, 'memory.afu'), keys, emptyMemory);
  }
  async load() {
    await this.file.load();
    return this.file.loadError;
  }
  flush() {
    return this.file.flush();
  }
  get doc(): MemoryDoc {
    return this.file.data;
  }

  // ---- profile
  get owner(): OwnerNames {
    const p = this.doc.profile;
    return { fullName: p.fullName, greetingName: p.greetingName, nickname: p.nickname };
  }
  setOwner(o: Partial<OwnerNames> & { language?: 'so' | 'en' }) {
    this.file.update((d) => Object.assign(d.profile, o));
  }

  // ---- facts (owner-verified vs unverified are strictly separate)
  addFact(text: string, trust: FactTrust, speaker?: string): MemoryFact {
    const now = Date.now();
    const f: MemoryFact = { id: uid('f_'), text: text.trim(), trust, speaker, createdAt: now, updatedAt: now };
    this.file.update((d) => d.facts.push(f));
    return f;
  }
  correctFact(id: string, text: string): boolean {
    let ok = false;
    this.file.update((d) => {
      const f = d.facts.find((x) => x.id === id);
      if (f) {
        f.text = text.trim();
        f.updatedAt = Date.now();
        ok = true;
      }
    });
    return ok;
  }
  deleteFact(id: string): boolean {
    let ok = false;
    this.file.update((d) => {
      const n = d.facts.length;
      d.facts = d.facts.filter((f) => f.id !== id);
      ok = d.facts.length !== n;
    });
    return ok;
  }
  /** Only these may be given to the AI as facts about the owner. */
  ownerFacts(): MemoryFact[] {
    return this.doc.facts.filter((f) => f.trust === 'owner');
  }
  unverifiedFacts(): MemoryFact[] {
    return this.doc.facts.filter((f) => f.trust === 'unverified');
  }

  // ---- preferences / favourites
  setPreference(k: string, v: string) {
    this.file.update((d) => {
      d.preferences[k] = v;
    });
  }
  addFavoriteApp(name: string) {
    this.file.update((d) => {
      if (!d.favorites.apps.includes(name)) d.favorites.apps.push(name);
    });
  }
  addFavoriteFolder(f: FolderEntry) {
    this.file.update((d) => {
      d.favorites.folders = d.favorites.folders.filter((x) => x.label !== f.label).concat(f);
    });
  }

  // ---- contacts
  get contacts(): Contact[] {
    return this.doc.contacts;
  }
  upsertContact(c: Omit<Contact, 'id'> & { id?: string }): Contact {
    const contact: Contact = { ...c, id: c.id ?? uid('c_'), phone: c.phone.replace(/\D/g, '') };
    this.file.update((d) => {
      const i = d.contacts.findIndex((x) => x.id === contact.id);
      if (i >= 0) d.contacts[i] = contact;
      else d.contacts.push(contact);
    });
    return contact;
  }
  deleteContact(id: string) {
    this.file.update((d) => {
      d.contacts = d.contacts.filter((c) => c.id !== id);
    });
  }

  // ---- history
  addTurn(t: Omit<ChatTurn, 'id' | 'at'> & { at?: number }): ChatTurn {
    const turn: ChatTurn = { id: uid('t_'), at: t.at ?? Date.now(), ...t } as ChatTurn;
    this.file.update((d) => d.history.push(turn));
    return turn;
  }
  recentTurns(n: number): ChatTurn[] {
    return this.doc.history.slice(-n);
  }
  clearHistory() {
    this.file.update((d) => {
      d.history = [];
    });
  }
  /** Apply retention. Days = 0 means "keep nothing". */
  prune(now: number, historyDays: number): number {
    let removed = 0;
    this.file.update((d) => {
      const cutoff = now - historyDays * 86_400_000;
      const before = d.history.length;
      d.history = historyDays === 0 ? [] : d.history.filter((t) => t.at >= cutoff);
      removed = before - d.history.length;
    });
    return removed;
  }

  // ---- export / wipe
  exportAll(): string {
    return JSON.stringify(this.doc, null, 2);
  }
  async wipeAll() {
    await this.file.destroy();
  }
}
