import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { safeStorage } from 'electron';

// Linux CI only (never Windows): lets the end-to-end test run without a desktop keyring.
if (process.env.AFUUFOW_TEST_PLAINTEXT_KEYSTORE === '1' && process.platform === 'linux') {
  (safeStorage as unknown as { setUsePlainTextEncryption?: (v: boolean) => void }).setUsePlainTextEncryption?.(true);
}
import type { KeyProvider } from '../core/storage/encrypted';
import type { SecretCipher } from '../core/storage/secrets';

/**
 * The data key for every encrypted file is random, and stored only in a form protected by the OS:
 * on Windows, Electron's safeStorage uses DPAPI, which binds the key to the signed-in Windows user account.
 */
export class DpapiKeyProvider implements KeyProvider {
  private key: Buffer | null = null;
  constructor(private dir: string) {}

  getKey(): Buffer {
    if (this.key) return this.key;
    const file = path.join(this.dir, 'afuufow.key');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows data protection (DPAPI) is not available; refusing to store the data key unprotected');
    if (fs.existsSync(file)) {
      this.key = Buffer.from(safeStorage.decryptString(fs.readFileSync(file)), 'base64');
    } else {
      this.key = randomBytes(32);
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(file, safeStorage.encryptString(this.key.toString('base64')));
    }
    return this.key;
  }
}

export const safeStorageCipher: SecretCipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (s) => safeStorage.encryptString(s),
  decrypt: (b) => safeStorage.decryptString(b),
};
