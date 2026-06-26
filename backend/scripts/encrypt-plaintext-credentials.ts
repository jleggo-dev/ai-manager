/**
 * One-time migration script: encrypt plaintext user credentials.
 *
 * Reads all rows from user_provider_credentials, identifies any that
 * are stored in plaintext (not valid AES-256-GCM ciphertext), encrypts
 * them with the current CREDENTIAL_ENCRYPTION_KEY, and writes them back.
 *
 * Usage:  npx tsx scripts/encrypt-plaintext-credentials.ts
 *
 * Requires:
 *   - CREDENTIAL_ENCRYPTION_KEY in env (or .env via dotenv)
 *   - AI_MANAGER_SUPABASE_URL + AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { encryptSecret, decryptSecret } from '../src/lib/crypto.ts';

const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function looksEncrypted(value: string): boolean {
  if (!BASE64_RE.test(value)) return false;
  const buf = Buffer.from(value, 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES) return false;
  try {
    decryptSecret(value);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const url = process.env.AI_MANAGER_SUPABASE_URL;
  const key = process.env.AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing AI_MANAGER_SUPABASE_URL or AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
    console.error('Missing CREDENTIAL_ENCRYPTION_KEY — cannot encrypt');
    process.exit(1);
  }

  const supabase = createClient(url, key);

  const { data: rows, error } = await supabase
    .from('user_provider_credentials')
    .select('id, user_id, provider_id, label, api_key');

  if (error) {
    console.error('Failed to fetch credentials:', error.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log('No credentials found.');
    return;
  }

  console.log(`Found ${rows.length} credential(s). Checking each…\n`);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const masked = row.api_key.slice(0, 6) + '…';

    if (looksEncrypted(row.api_key)) {
      console.log(`  [skip]    ${row.id}  (${row.label || 'no label'})  — already encrypted`);
      skipped++;
      continue;
    }

    console.log(`  [encrypt] ${row.id}  (${row.label || 'no label'})  — plaintext detected (${masked})`);
    const encrypted = encryptSecret(row.api_key);

    const { error: updateErr } = await supabase
      .from('user_provider_credentials')
      .update({ api_key: encrypted, updated_at: new Date().toISOString() })
      .eq('id', row.id);

    if (updateErr) {
      console.error(`  [FAILED]  ${row.id}: ${updateErr.message}`);
    } else {
      console.log(`  [done]    ${row.id}  — encrypted and saved (${encrypted.slice(0, 10)}…)`);
      updated++;
    }
  }

  console.log(`\nDone. Encrypted: ${updated}, Already encrypted: ${skipped}, Total: ${rows.length}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
