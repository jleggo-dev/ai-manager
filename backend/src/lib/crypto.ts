/**
 * AES-256-GCM encryption helpers for API keys at rest.
 *
 * Ciphertext format stored in DB: base64(iv || authTag || ciphertext)
 * - iv:         12 bytes (96-bit nonce, recommended for GCM)
 * - authTag:    16 bytes (128-bit authentication tag)
 * - ciphertext: variable length
 *
 * The 256-bit encryption key is read from CREDENTIAL_ENCRYPTION_KEY env var
 * (hex-encoded, 64 chars).
 *
 * In production (NODE_ENV=production), the key is REQUIRED — the server
 * refuses to start without it. In development, a missing key logs a warning
 * and encryption is bypassed (plaintext stored).
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGO = 'aes-256-gcm' as const;
const IV_BYTES = 12;
const TAG_BYTES = 16;

let _cachedKey: Buffer | null | undefined;
let _keyChecked = false;

function getKeyBuffer(): Buffer | null {
  if (_keyChecked) return _cachedKey ?? null;
  _keyChecked = true;

  const hex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!hex) {
    const env = process.env.NODE_ENV || '';
    if (env === 'development' || env === 'test') {
      console.warn(
        '[crypto] CREDENTIAL_ENCRYPTION_KEY not set — credentials will be stored in plaintext. ' +
          'This is only allowed in development/test environments.',
      );
      _cachedKey = null;
      return null;
    }
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY is required in all non-development environments. ' +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }

  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be exactly 64 hex chars (32 bytes / 256 bits)');
  }
  _cachedKey = buf;
  return buf;
}

/**
 * Encrypt a plaintext string. Returns a base64 blob suitable for TEXT column storage.
 * If no encryption key is configured (dev only), returns the plaintext unchanged.
 */
export function encryptSecret(plaintext: string): string {
  const key = getKeyBuffer();
  if (!key) return plaintext;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypt a value produced by `encryptSecret`. Returns the original plaintext.
 * If no encryption key is configured (dev only), returns the value unchanged.
 * Throws if the key IS configured but the stored value is not valid ciphertext.
 */
export function decryptSecret(stored: string): string {
  const key = getKeyBuffer();
  if (!key) return stored;

  const buf = Buffer.from(stored, 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES) {
    throw new Error(
      'Stored credential is not valid ciphertext — it may have been saved without encryption. Re-save the credential to encrypt it.',
    );
  }

  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
