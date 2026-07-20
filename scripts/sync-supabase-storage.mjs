#!/usr/bin/env node
/**
 * Copy Supabase Storage objects from source project to destination.
 * Database dump/restore does NOT copy bucket files.
 *
 * Usage:
 *   Set env (or use backend/.env + backend/.env.replica):
 *     SOURCE_SUPABASE_URL, SOURCE_SUPABASE_SERVICE_ROLE_KEY
 *     TARGET_SUPABASE_URL, TARGET_SUPABASE_SERVICE_ROLE_KEY
 *
 *   node scripts/sync-supabase-storage.mjs
 *   node scripts/sync-supabase-storage.mjs --bucket <bucket-name>
 *
 * Loads backend/.env for TARGET_* if TARGET vars unset.
 * Loads backend/.env.replica for SOURCE_* if SOURCE vars unset (copy from .env.replica.example).
 */

import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, '../backend');

function loadEnvFile(path, keys) {
  if (!existsSync(path)) return;
  const parsed = dotenv.parse(readFileSync(path, 'utf8'));
  for (const key of keys) {
    const v = parsed[key];
    if (v != null && String(v).trim() !== '' && !process.env[key]) {
      process.env[key] = String(v).trim();
    }
  }
}

dotenv.config({ path: resolve(backendRoot, '.env') });
loadEnvFile(resolve(backendRoot, '.env.replica'), [
  'SOURCE_SUPABASE_URL',
  'SOURCE_SUPABASE_SERVICE_ROLE_KEY',
  'TARGET_SUPABASE_URL',
  'TARGET_SUPABASE_SERVICE_ROLE_KEY',
]);
loadEnvFile(resolve(backendRoot, '.env'), [
  'AI_MANAGER_SUPABASE_URL',
  'AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY',
]);

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

const sourceUrl = process.env.SOURCE_SUPABASE_URL || requireEnv('SOURCE_AI_MANAGER_SUPABASE_URL');
const sourceKey =
  process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY ||
  requireEnv('SOURCE_AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY');
const targetUrl = process.env.TARGET_SUPABASE_URL || requireEnv('AI_MANAGER_SUPABASE_URL');
const targetKey =
  process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY ||
  requireEnv('AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY');

if (sourceUrl === targetUrl) {
  throw new Error('Source and target Supabase URLs must differ');
}

const bucketArg = process.argv.find((a) => a.startsWith('--bucket='));
const singleBucket = bucketArg ? bucketArg.slice('--bucket='.length) : null;

const DEFAULT_BUCKETS = []; // pass --bucket=<name>; no default buckets after widget-hc removal

const source = createClient(sourceUrl, sourceKey);
const target = createClient(targetUrl, targetKey);

async function listAllObjects(client, bucket, prefix = '') {
  const out = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`[${bucket}] list ${prefix || '/'}: ${error.message}`);
    const entries = data ?? [];
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) out.push(path);
      else {
        const nested = await listAllObjects(client, bucket, path);
        out.push(...nested);
      }
    }
    if (entries.length < limit) break;
    offset += limit;
  }
  return out;
}

async function syncBucket(bucket) {
  console.log(`\n  Bucket: ${bucket}`);
  const { data: srcMeta, error: srcErr } = await source.storage.getBucket(bucket);
  if (srcErr) {
    console.log(`    Source bucket missing or inaccessible — skip (${srcErr.message})`);
    return { copied: 0, skipped: true };
  }

  const { data: dstMeta } = await target.storage.getBucket(bucket);
  if (!dstMeta) {
    const { error: createErr } = await target.storage.createBucket(bucket, {
      public: srcMeta.public,
      fileSizeLimit: srcMeta.file_size_limit ?? undefined,
      allowedMimeTypes: srcMeta.allowed_mime_types ?? undefined,
    });
    if (createErr) throw new Error(`[${bucket}] create bucket: ${createErr.message}`);
    console.log(`    Created bucket on target (public=${srcMeta.public})`);
  }

  const paths = await listAllObjects(source, bucket);
  console.log(`    ${paths.length} object(s) to copy`);
  let copied = 0;
  for (const path of paths) {
    const { data: blob, error: dlErr } = await source.storage.from(bucket).download(path);
    if (dlErr) throw new Error(`[${bucket}] download ${path}: ${dlErr.message}`);
    const { error: upErr } = await target.storage.from(bucket).upload(path, blob, {
      upsert: true,
      contentType: blob.type || undefined,
    });
    if (upErr) throw new Error(`[${bucket}] upload ${path}: ${upErr.message}`);
    copied++;
    if (copied % 25 === 0) console.log(`    … ${copied}/${paths.length}`);
  }
  console.log(`    Done: ${copied} file(s)`);
  return { copied, skipped: false };
}

async function main() {
  const buckets = singleBucket ? [singleBucket] : DEFAULT_BUCKETS;
  console.log('\n  Supabase Storage sync');
  console.log(`  From: ${sourceUrl}`);
  console.log(`  To:   ${targetUrl}`);

  let total = 0;
  for (const b of buckets) {
    const r = await syncBucket(b);
    total += r.copied;
  }
  console.log(`\n  Finished. ${total} file(s) copied.\n`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
