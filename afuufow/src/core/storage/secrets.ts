import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Pluggable secret protection. Production: Electron safeStorage (Windows DPAPI, bound to the
 * signed-in Windows user). The ciphertext (never the plaintext) is stored on disk.
 */
export interface SecretCipher {
  encrypt(plain: string): Buffer;
  decrypt(blob: Buffer): string;
  available(): boolean;
}

export class SecretStore {
  private file: string;
  private cache: Record<string, string> = {};

  constructor(
    dir: string,
    private cipher: SecretCipher,
  ) {
    this.file = path.join(dir, 'secrets.json');
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.file)) this.cache = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.cache = {};
    }
  }

  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.cache));
  }

  has(name: string): boolean {
    return name in this.cache;
  }

  names(): string[] {
    return Object.keys(this.cache);
  }

  set(name: string, value: string): void {
    if (!this.cipher.available()) throw new Error('OS secret storage is not available; refusing to store secret in plain text');
    this.cache[name] = this.cipher.encrypt(value).toString('base64');
    this.save();
  }

  get(name: string): string | null {
    const v = this.cache[name];
    if (!v) return null;
    try {
      return this.cipher.decrypt(Buffer.from(v, 'base64'));
    } catch {
      return null;
    }
  }

  delete(name: string): void {
    delete this.cache[name];
    this.save();
  }
}

/** Well-known secret names. */
export const SECRET = {
  azureSpeechKey: 'azure.speech.key',
  openaiKey: 'openai.key',
  anthropicKey: 'anthropic.key',
  youtubeApiKey: 'youtube.apikey',
  ownerPinHash: 'owner.pin.hash',
} as const;
