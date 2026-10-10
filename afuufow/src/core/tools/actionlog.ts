import * as path from 'node:path';
import type { ActionRecord, ToolResult, ToolRisk } from '../../shared/types';
import { type KeyProvider, EncryptedJsonFile } from '../storage/encrypted';
import { redact, uid } from '../util';

interface Doc {
  version: 1;
  records: ActionRecord[];
}

export class ActionLog {
  private file: EncryptedJsonFile<Doc> | null;
  private mem: ActionRecord[] = [];
  private listeners = new Set<(r: ActionRecord) => void>();

  constructor(dir?: string, keys?: KeyProvider) {
    this.file = dir && keys ? new EncryptedJsonFile<Doc>(path.join(dir, 'actions.afu'), keys, () => ({ version: 1, records: [] })) : null;
  }
  async load() {
    if (this.file) {
      await this.file.load();
      this.mem = this.file.data.records;
    }
  }
  flush() {
    return this.file?.flush() ?? Promise.resolve();
  }
  onChange(fn: (r: ActionRecord) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  begin(r: { tool: string; summary: string; risk: ToolRisk; decidedBy: ActionRecord['decidedBy'] }): ActionRecord {
    const rec: ActionRecord = { id: uid('a_'), at: Date.now(), status: 'running', ...r, summary: redact(r.summary) };
    this.mem.push(rec);
    this.touch(rec);
    return rec;
  }
  finish(id: string, result: ToolResult): ActionRecord {
    const rec = this.mem.find((r) => r.id === id)!;
    rec.finishedAt = Date.now();
    rec.status = result.status;
    rec.message = result.en;
    rec.verification = result.verification ? `${result.verification.method}${result.verification.observed ? ': ' + result.verification.observed : ''}` : undefined;
    this.touch(rec);
    return rec;
  }
  private touch(rec: ActionRecord) {
    this.file?.update((d) => {
      d.records = this.mem;
    });
    for (const l of this.listeners) l(rec);
  }

  list(limit = 200): ActionRecord[] {
    return this.mem.slice(-limit).reverse();
  }
  prune(now: number, days: number): number {
    const before = this.mem.length;
    const cutoff = now - days * 86_400_000;
    this.mem = days === 0 ? [] : this.mem.filter((r) => r.at >= cutoff);
    this.file?.update((d) => {
      d.records = this.mem;
    });
    return before - this.mem.length;
  }
  clear() {
    this.mem = [];
    this.file?.update((d) => {
      d.records = this.mem;
    });
  }
  export(): string {
    return JSON.stringify(this.mem, null, 2);
  }
}
