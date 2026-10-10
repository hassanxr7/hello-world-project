import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Supplies the 32-byte data key. In production it is wrapped by Windows DPAPI (Electron safeStorage). */
export interface KeyProvider {
  getKey(): Promise<Buffer> | Buffer;
}

export class StaticKeyProvider implements KeyProvider {
  constructor(private key: Buffer) {
    if (key.length !== 32) throw new Error('key must be 32 bytes');
  }
  getKey() {
    return this.key;
  }
}

export interface Envelope {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

export function encryptBytes(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  const tag = c.getAuthTag();
  // layout: 'AFU1' | iv(12) | tag(16) | ciphertext
  return Buffer.concat([Buffer.from('AFU1'), iv, tag, enc]);
}

export function decryptBytes(key: Buffer, blob: Buffer): Buffer {
  if (blob.length < 32 || blob.subarray(0, 4).toString() !== 'AFU1') throw new Error('bad encrypted blob');
  const iv = blob.subarray(4, 16);
  const tag = blob.subarray(16, 32);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(blob.subarray(32)), d.final()]);
}

/** Atomic, encrypted JSON document with a debounced writer and a .bak fallback. */
export class EncryptedJsonFile<T> {
  private value: T;
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  /** Set when the file existed but could not be decrypted/parsed. */
  public loadError: string | null = null;
  /** Last background save failure (e.g. disk full). Surfaced in diagnostics instead of crashing. */
  public saveError: string | null = null;

  constructor(
    private file: string,
    private keys: KeyProvider,
    private initial: () => T,
  ) {
    this.value = initial();
  }

  async load(): Promise<T> {
    const key = await this.keys.getKey();
    for (const candidate of [this.file, this.file + '.bak']) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const plain = decryptBytes(key, fs.readFileSync(candidate));
        this.value = JSON.parse(plain.toString('utf8')) as T;
        this.loadError = candidate === this.file ? null : `restored from backup (${path.basename(candidate)})`;
        return this.value;
      } catch (e) {
        this.loadError = `could not read ${path.basename(candidate)}: ${(e as Error).message}`;
      }
    }
    this.value = this.initial();
    return this.value;
  }

  get data(): T {
    return this.value;
  }

  /** Mutate and schedule a save. */
  update(fn: (d: T) => void): void {
    fn(this.value);
    this.dirty = true;
    if (!this.timer) this.timer = setTimeout(() => void this.flush().catch((e: Error) => (this.saveError = e.message)), 400);
  }

  replace(v: T): void {
    this.value = v;
    this.dirty = true;
    if (!this.timer) this.timer = setTimeout(() => void this.flush().catch((e: Error) => (this.saveError = e.message)), 400);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return this.writing;
    this.dirty = false;
    const snapshot = JSON.stringify(this.value);
    this.writing = this.writing.then(async () => {
      const key = await this.keys.getKey();
      const blob = encryptBytes(key, Buffer.from(snapshot, 'utf8'));
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, blob);
      if (fs.existsSync(this.file)) {
        try {
          fs.copyFileSync(this.file, this.file + '.bak');
        } catch {
          /* best effort */
        }
      }
      fs.renameSync(tmp, this.file);
    });
    return this.writing;
  }

  /** Securely forget: remove file and backup. */
  async destroy(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.dirty = false;
    await this.writing;
    for (const f of [this.file, this.file + '.bak', this.file + '.tmp']) {
      try {
        fs.rmSync(f, { force: true });
      } catch {
        /* ignore */
      }
    }
    this.value = this.initial();
  }
}

/** Encrypted blobs (visitor snapshots). */
export class EncryptedBlobDir {
  constructor(
    private dir: string,
    private keys: KeyProvider,
  ) {}
  async put(id: string, bytes: Buffer): Promise<string> {
    fs.mkdirSync(this.dir, { recursive: true });
    const p = path.join(this.dir, safeName(id) + '.afu');
    fs.writeFileSync(p, encryptBytes(await this.keys.getKey(), bytes));
    return p;
  }
  async get(id: string): Promise<Buffer | null> {
    const p = path.join(this.dir, safeName(id) + '.afu');
    if (!fs.existsSync(p)) return null;
    return decryptBytes(await this.keys.getKey(), fs.readFileSync(p));
  }
  delete(id: string): void {
    fs.rmSync(path.join(this.dir, safeName(id) + '.afu'), { force: true });
  }
  deleteAll(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

function safeName(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_');
}
