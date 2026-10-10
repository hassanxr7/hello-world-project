import * as path from 'node:path';
import { type KeyProvider, EncryptedBlobDir, EncryptedJsonFile } from '../storage/encrypted';
import { uid } from '../util';

export type ConsentStatus = 'responded_after_notice' | 'declined' | 'no_response' | 'not_asked' | 'interrupted';

export interface VisitorEvent {
  id: string;
  at: number;
  /** Camera observation. These fields describe the camera only; they say nothing about who used Windows. */
  faceRecognized: false;
  recognitionState: 'unknown' | 'uncertain';
  /** Best similarity to the owner's template (null if unavailable). */
  recognitionConfidence: number | null;
  /** SELF-REPORTED, unverified. Never promoted to owner facts. */
  selfReportedName: string | null;
  selfReportedGender: string | null;
  /** The visitor's own words (transcript). Present only if they responded after the notice. */
  transcript: string | null;
  consent: ConsentStatus;
  /** The consent notice (and any extra disclosures) really were spoken before recording. */
  noticeSpokenAt: number | null;
  disclosures: Array<'snapshot' | 'audio'>;
  snapshotId: string | null;
  audioId: string | null;
  reported: boolean;
  ownerNote: string | null;
  markedKnownAs: string | null;
}

export interface SessionEvent {
  id: string;
  at: number;
  kind: 'lock' | 'unlock' | 'suspend' | 'resume' | 'signin' | 'app_start' | 'logon_event' | 'logon_failure';
  source: 'power-monitor' | 'event-log' | 'app';
  detail?: string;
}

interface Doc {
  version: 1;
  events: VisitorEvent[];
  session: SessionEvent[];
}

export class VisitorLog {
  private file: EncryptedJsonFile<Doc>;
  readonly blobs: EncryptedBlobDir;
  private listeners = new Set<() => void>();

  constructor(dir: string, keys: KeyProvider) {
    this.file = new EncryptedJsonFile<Doc>(path.join(dir, 'visitors.afu'), keys, () => ({ version: 1, events: [], session: [] }));
    this.blobs = new EncryptedBlobDir(path.join(dir, 'visitor-media'), keys);
  }
  async load() {
    await this.file.load();
  }
  flush() {
    return this.file.flush();
  }
  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed() {
    for (const l of this.listeners) l();
  }

  add(e: Omit<VisitorEvent, 'id' | 'reported' | 'ownerNote' | 'markedKnownAs' | 'faceRecognized'>): VisitorEvent {
    const ev: VisitorEvent = { ...e, id: uid('v_'), faceRecognized: false, reported: false, ownerNote: null, markedKnownAs: null };
    this.file.update((d) => d.events.push(ev));
    this.changed();
    return ev;
  }
  list(): VisitorEvent[] {
    return [...this.file.data.events].sort((a, b) => b.at - a.at);
  }
  pending(): VisitorEvent[] {
    return this.file.data.events.filter((e) => !e.reported).sort((a, b) => a.at - b.at);
  }
  get(id: string) {
    return this.file.data.events.find((e) => e.id === id);
  }
  markReported(ids: string[]) {
    this.file.update((d) => {
      for (const e of d.events) if (ids.includes(e.id)) e.reported = true;
    });
    this.changed();
  }
  addNote(id: string, note: string) {
    this.file.update((d) => {
      const e = d.events.find((x) => x.id === id);
      if (e) e.ownerNote = note;
    });
    this.changed();
  }
  /** Only labels the event; recognising this person in future requires a separate face enrollment. */
  markKnown(id: string, label: string) {
    this.file.update((d) => {
      const e = d.events.find((x) => x.id === id);
      if (e) e.markedKnownAs = label;
    });
    this.changed();
  }
  delete(id: string) {
    const ev = this.get(id);
    if (ev?.snapshotId) this.blobs.delete(ev.snapshotId);
    if (ev?.audioId) this.blobs.delete(ev.audioId);
    this.file.update((d) => {
      d.events = d.events.filter((e) => e.id !== id);
    });
    this.changed();
  }
  deleteAll() {
    this.blobs.deleteAll();
    this.file.update((d) => {
      d.events = [];
    });
    this.changed();
  }

  // ---- Windows session events (recorded separately from camera observations)
  addSession(e: Omit<SessionEvent, 'id'>): SessionEvent {
    const ev: SessionEvent = { ...e, id: uid('s_') };
    this.file.update((d) => {
      d.session.push(ev);
      if (d.session.length > 2000) d.session = d.session.slice(-2000);
    });
    this.changed();
    return ev;
  }
  sessionEvents(): SessionEvent[] {
    return [...this.file.data.session].sort((a, b) => b.at - a.at);
  }
  sessionNear(at: number, windowMs: number): SessionEvent[] {
    return this.file.data.session.filter((s) => Math.abs(s.at - at) <= windowMs && (s.kind === 'unlock' || s.kind === 'signin' || s.kind === 'logon_event' || s.kind === 'resume'));
  }

  /** Retention. Removes events and their media older than `days`. */
  prune(now: number, days: number, snapshotDays: number): number {
    const cutoff = now - days * 86_400_000;
    const snapCut = now - snapshotDays * 86_400_000;
    let removed = 0;
    for (const e of [...this.file.data.events]) {
      if (days === 0 || e.at < cutoff) {
        this.delete(e.id);
        removed++;
      } else if (e.snapshotId && (snapshotDays === 0 || e.at < snapCut)) {
        this.blobs.delete(e.snapshotId);
        this.file.update(() => {
          e.snapshotId = null;
        });
      }
    }
    this.file.update((d) => {
      d.session = d.session.filter((s) => s.at >= cutoff);
    });
    return removed;
  }
  exportAll(): string {
    return JSON.stringify({ events: this.list(), session: this.sessionEvents() }, null, 2);
  }
}
