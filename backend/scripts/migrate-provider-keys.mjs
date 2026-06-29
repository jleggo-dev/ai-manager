#!/usr/bin/env node
/**
 * Copy provider api_key values from source Supabase (backend/.env.replica) into
 * destination (backend/.env). Decrypts with source encryption key if needed,
 * re-encrypts with destination CREDENTIAL_ENCRYPTION_KEY.
 *
 * Usage:
 *   node backend/scripts/migrate-provider-keys.mjs [--dry-run]
 *
 * Optional env in .env.replica:
 *   SOURCE_CREDENTIAL_ENCRYPTION_KEY — if source used a different key than destination
 */

import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, '..');

dotenv.config({ path: resolve(backendRoot, '.env') });

const replicaPath = resolve(backendRoot, '.env.replica');
if (!existsSync(replicaPath)) {
  console.error('Missing backend/.env.replica');
  process.exit(1);
}
const replica = dotenv.parse(readFileSync(replicaPath, 'utf8'));

const dryRun = process.argv.includes('--dry-run');

function requireEnv(name, env = process.env) {
  const v = env[name];
  if (!v?.trim()) throw new Error(`Missing ${name}`);
  return v.trim();
}

function keyBuffer(hex, label) {
  if (!hex) return null;
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) throw new Error(`${label} must be 64 hex chars`);
  return buf;
}

function decryptSecret(stored, key) {
  if (!key) return stored;
  const buf = Buffer.from(stored, 'base64');
  if (buf.length < 28) throw new Error('Not valid ciphertext');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function encryptSecret(plaintext, key) {
  if (!key) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function mask(s) {
  if (!s || s.length < 10) return '(empty/short)';
  return `${s.slice(0, 6)}…${s.slice(-4)} (${s.length} chars)`;
}

async function main() {
  const srcUrl = requireEnv('SOURCE_SUPABASE_URL', replica);
  const srcKey = requireEnv('SOURCE_SUPABASE_SERVICE_ROLE_KEY', replica);
  const destUrl = requireEnv('AI_MANAGER_SUPABASE_URL');
  const destSvc = requireEnv('AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY');

  const destEncKey = keyBuffer(requireEnv('CREDENTIAL_ENCRYPTION_KEY'), 'CREDENTIAL_ENCRYPTION_KEY');
  const srcEncKey =
    keyBuffer(replica.SOURCE_CREDENTIAL_ENCRYPTION_KEY, 'SOURCE_CREDENTIAL_ENCRYPTION_KEY') ?? destEncKey;

  const source = createClient(srcUrl, srcKey);
  const dest = createClient(destUrl, destSvc);

  const { data: srcRows, error: srcErr } = await source
    .from('providers')
    .select('id,name,type,api_key,base_url,is_active,request_timeout_ms')
    .in('name', ['Devs.ai', 'Google Gemini'])
    .order('name');
  if (srcErr) throw new Error(`Source select: ${srcErr.message}`);

  const { data: destRows, error: destErr } = await dest.from('providers').select('id,name,type,api_key');
  if (destErr) throw new Error(`Dest select: ${destErr.message}`);

  const destById = new Map((destRows ?? []).map((r) => [r.id, r]));
  const destByType = new Map((destRows ?? []).map((r) => [r.type, r]));

  console.log('\n  Provider API key migration');
  console.log(`  From: ${srcUrl}`);
  console.log(`  To:   ${destUrl}`);
  if (dryRun) console.log('  Mode: dry-run\n');

  let updated = 0;

  for (const src of srcRows ?? []) {
    if (!src.api_key?.trim()) {
      console.log(`  SKIP ${src.name}: no api_key in source`);
      continue;
    }

    let plaintext;
    try {
      plaintext = decryptSecret(src.api_key, srcEncKey);
    } catch {
      try {
        plaintext = decryptSecret(src.api_key, destEncKey);
      } catch {
        /* Old DB often stored keys as plaintext */
        if (/^(sk-|AIza)/.test(src.api_key)) {
          plaintext = src.api_key;
        } else {
          console.log(`  FAIL ${src.name}: cannot decrypt source api_key`);
          continue;
        }
      }
    }

    const target = destById.get(src.id) ?? destByType.get(src.type);
    if (!target) {
      console.log(`  SKIP ${src.name}: no matching provider in destination (type=${src.type})`);
      continue;
    }

    let destPlain = null;
    let destIsEncrypted = false;
    if (target.api_key) {
      try {
        destPlain = decryptSecret(target.api_key, destEncKey);
        destIsEncrypted = true;
      } catch {
        if (/^(sk-|AIza)/.test(target.api_key)) destPlain = target.api_key;
      }
    }

    if (destPlain === plaintext && destIsEncrypted) {
      console.log(`  OK   ${src.name}: destination key already encrypted and matches`);
      continue;
    }

    const newCipher = encryptSecret(plaintext, destEncKey);
    console.log(`  UPDATE ${src.name} → ${target.id} (${mask(plaintext)})`);

    if (!dryRun) {
      const { error: upErr } = await dest
        .from('providers')
        .update({ api_key: newCipher, updated_at: new Date().toISOString() })
        .eq('id', target.id);
      if (upErr) throw new Error(`Update ${src.name}: ${upErr.message}`);
    }
    updated++;
  }

  console.log(`\n  Done. ${updated} provider key(s) ${dryRun ? 'would be ' : ''}updated.\n`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
