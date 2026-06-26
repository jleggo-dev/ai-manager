/**
 * E2E: Credential Encryption
 * ---------------------------
 * Verifies that user credentials stored in the DB are properly encrypted
 * and that the encryption/decryption roundtrip works.
 *
 * When CREDENTIAL_ENCRYPTION_KEY is set (production-like):
 *   - encryptSecret produces base64
 *   - decryptSecret recovers the original
 *   - decryptSecret throws on plaintext
 *   - All DB credentials are encrypted (not plaintext sk-… strings)
 *
 * When the key is NOT set (local dev):
 *   - Functions are passthroughs — we skip encryption-specific assertions
 *   - DB audit still runs but expects plaintext format
 */
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { encryptSecret, decryptSecret } from '../src/lib/crypto.ts';

const url = process.env.AI_MANAGER_SUPABASE_URL ?? '';
const key = process.env.AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY ?? '';
const supabase = createClient(url, key);

const hasEncryptionKey = !!process.env.CREDENTIAL_ENCRYPTION_KEY;
const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;

describe('E2E: Credential Encryption — core roundtrip', () => {
  it('encryptSecret → decryptSecret recovers the original', () => {
    const original = 'sk-roundtrip-test-' + Date.now();
    const encrypted = encryptSecret(original);
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(original);
  });

  it.skipIf(!hasEncryptionKey)('encryptSecret produces valid base64 when key is set', () => {
    const encrypted = encryptSecret('sk-test-key-12345');
    expect(BASE64_RE.test(encrypted)).toBe(true);
    expect(encrypted.length).toBeGreaterThan(40);
  });

  it.skipIf(!hasEncryptionKey)('decryptSecret throws on plaintext when key is set', () => {
    expect(() => decryptSecret('sk-plaintext-key')).toThrow();
  });

  it.skipIf(!hasEncryptionKey)('decryptSecret throws on tampered ciphertext', () => {
    const encrypted = encryptSecret('sk-tamper-test');
    const tampered = encrypted.slice(0, -4) + 'XXXX';
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe('E2E: Credential Encryption — DB audit (user_provider_credentials)', () => {
  it('all stored credentials are in the expected format', async () => {
    const { data: rows, error } = await supabase
      .from('user_provider_credentials')
      .select('id, label, api_key');

    expect(error).toBeNull();
    if (!rows || rows.length === 0) return;

    for (const row of rows) {
      if (hasEncryptionKey) {
        expect(
          BASE64_RE.test(row.api_key),
          `Credential "${row.label || row.id}" appears to be plaintext — expected encrypted base64`,
        ).toBe(true);
      }

      expect(
        () => decryptSecret(row.api_key),
        `Credential "${row.label || row.id}" fails decryption roundtrip`,
      ).not.toThrow();
    }
  });

  it.skipIf(!hasEncryptionKey)('no credential starts with "sk-" (plaintext leak)', async () => {
    const { data: rows, error } = await supabase
      .from('user_provider_credentials')
      .select('id, label, api_key');

    expect(error).toBeNull();
    if (!rows || rows.length === 0) return;

    for (const row of rows) {
      expect(
        row.api_key.startsWith('sk-'),
        `Credential "${row.label || row.id}" is stored as plaintext (starts with sk-)`,
      ).toBe(false);
    }
  });
});
