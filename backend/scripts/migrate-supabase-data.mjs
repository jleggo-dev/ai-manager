#!/usr/bin/env node
/**
 * Copy AI Manager rows from a source Supabase project into the destination
 * project configured in backend/.env (same schema as migrations/001_aim_full_schema.sql).
 *
 * Usage:
 *   npm run migrate:data --workspace=backend
 *   npm run migrate:data --workspace=backend -- --replace
 *
 * --replace  Delete all rows in destination AI Manager tables (FK-safe order), then copy.
 *
 * Requires:
 *   backend/.env — AI_MANAGER_SUPABASE_* (destination)
 *   backend/.env.old — SOURCE_AI_MANAGER_SUPABASE_* (old project; copy from .env.old.example)
 */

import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, '..');

dotenv.config({ path: resolve(backendRoot, '.env') });

const oldEnvPath = resolve(backendRoot, '.env.old');
if (existsSync(oldEnvPath)) {
  const parsed = dotenv.parse(readFileSync(oldEnvPath, 'utf8'));
  for (const key of ['SOURCE_AI_MANAGER_SUPABASE_URL', 'SOURCE_AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY']) {
    const v = parsed[key];
    if (v != null && String(v).trim() !== '') process.env[key] = String(v).trim();
  }
}

const UUID_NIL = '00000000-0000-0000-0000-000000000000';
const BATCH = 250;

const TABLES_BY_ID = [
  'providers',
  'ai_profiles',
  'llm_models',
  'processing_job_groups',
  'processing_jobs',
  'chat_sessions',
  'chat_messages',
  'diagnostic_logs',
];

/** @type {readonly { table: string, conflict: string, order?: string }[]} */
const SPECIAL_TABLES = [{ table: 'app_settings', conflict: 'key', order: 'key' }];

/** PostgREST returns at most ~1000 rows per request unless paginated. */
const SELECT_PAGE = 1000;

function requireEnv(name) {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return v.trim();
}

function parseArgs() {
  const args = process.argv.slice(2);
  return { replace: args.includes('--replace') };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} dest
 * @param {string} table
 * @param {string} conflictColumn
 */
async function deleteAllRows(dest, table, conflictColumn = 'id') {
  const q = dest.from(table).delete();
  const { error } =
    conflictColumn === 'key'
      ? await q.not('key', 'is', null)
      : await q.neq(conflictColumn, UUID_NIL);
  if (error) throw new Error(`[${table}] delete all: ${error.message}`);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} dest
 */
async function clearDestination(dest) {
  console.log('\n  Clearing destination tables (--replace)…');
  for (const t of TABLES_BY_ID.slice().reverse()) await deleteAllRows(dest, t, 'id');
  for (const { table, conflict } of SPECIAL_TABLES.slice().reverse()) {
    await deleteAllRows(dest, table, conflict);
  }
  console.log('  Done clearing.\n');
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} source
 * @param {import('@supabase/supabase-js').SupabaseClient} dest
 * @param {string} table
 * @param {string} onConflict
 * @param {string} [orderColumn='id']
 */
async function copyTable(source, dest, table, onConflict, orderColumn = 'id') {
  const rows = [];
  let rangeStart = 0;
  while (true) {
    const { data, error } = await source
      .from(table)
      .select('*')
      .order(orderColumn, { ascending: true })
      .range(rangeStart, rangeStart + SELECT_PAGE - 1);
    if (error) throw new Error(`[${table}] source select: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < SELECT_PAGE) break;
    rangeStart += SELECT_PAGE;
  }

  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows (skip)`);
    return 0;
  }

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error: upErr } = await dest.from(table).upsert(chunk, { onConflict });
    if (upErr) throw new Error(`[${table}] upsert: ${upErr.message}`);
  }

  console.log(`  ${table}: ${rows.length} rows`);
  return rows.length;
}

async function main() {
  const { replace } = parseArgs();

  const destUrl = requireEnv('AI_MANAGER_SUPABASE_URL');
  const destKey = requireEnv('AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY');
  const srcUrl = requireEnv('SOURCE_AI_MANAGER_SUPABASE_URL');
  const srcKey = requireEnv('SOURCE_AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY');

  if (srcUrl === destUrl) {
    throw new Error('SOURCE_AI_MANAGER_SUPABASE_URL must differ from AI_MANAGER_SUPABASE_URL');
  }

  const source = createClient(srcUrl, srcKey);
  const dest = createClient(destUrl, destKey);

  console.log('\n  AI Manager — Supabase data copy');
  console.log(`  From: ${srcUrl}`);
  console.log(`  To:   ${destUrl}`);
  if (replace) console.log('  Mode: replace (destination rows cleared first)');

  if (replace) await clearDestination(dest);

  let total = 0;
  console.log('\n  Copying…');
  for (const t of TABLES_BY_ID) total += await copyTable(source, dest, t, 'id');
  for (const { table, conflict, order } of SPECIAL_TABLES) {
    total += await copyTable(source, dest, table, conflict, order ?? 'key');
  }

  console.log(`\n  Finished. ${total} rows upserted in total.\n`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
