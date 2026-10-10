import * as fs from 'node:fs';
import * as path from 'node:path';
import { redact } from '../core/util';

/** Small rotating file logger. Never logs audio, images, transcripts of visitors, or secrets (messages are redacted). */
export class Logger {
  private file: string;
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'afuufow.log');
    try {
      if (fs.existsSync(this.file) && fs.statSync(this.file).size > 2_000_000) {
        fs.rmSync(this.file + '.1', { force: true });
        fs.renameSync(this.file, this.file + '.1');
      }
    } catch {
      /* best effort */
    }
  }
  private write(level: string, msg: string) {
    const line = `${new Date().toISOString()} ${level} ${redact(msg)}\n`;
    try {
      fs.appendFileSync(this.file, line);
    } catch {
      /* ignore */
    }
  }
  info(msg: string) { this.write('INFO ', msg); }
  warn(msg: string) { this.write('WARN ', msg); }
  error(msg: string, e?: unknown) { this.write('ERROR', msg + (e ? ' :: ' + ((e as Error).stack ?? String(e)) : '')); }
  get path() { return this.dir; }
}
