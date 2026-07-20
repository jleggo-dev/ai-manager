/**
 * Post-merge / post-E2E cleanup for AI Admin leftovers.
 *
 * Deletes ONLY rows clearly tagged as automated test artifacts:
 *   - diagnostic_logs.calling_application LIKE 'e2e%'
 *   - chat_sessions.calling_application LIKE 'e2e%'
 *   - calling_applications.display_name LIKE 'e2e%'
 *
 * Never touches production calling apps (e.g. platform:cadence) or real user sessions.
 *
 * Usage (from repo root, PowerShell):
 *   npx tsx backend/scripts/cleanup-e2e-test-data.ts          # dry-run (counts)
 *   npx tsx backend/scripts/cleanup-e2e-test-data.ts --yes    # apply deletes
 *
 * Requires backend/.env: AI_MANAGER_SUPABASE_URL + AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(repoRoot, 'backend/.env') });

const E2E_PREFIX = 'e2e%';
const PAGE = 500;

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing ${name} (load backend/.env)`);
    process.exit(1);
  }
  return v;
}

async function countLike(
  sb: SupabaseClient,
  table: string,
  column: string,
  pattern: string,
): Promise<number> {
  const { count, error } = await sb
    .from(table)
    .select('*', { count: 'exact', head: true })
    .like(column, pattern);
  if (error) throw new Error(`${table} count: ${error.message}`);
  return count ?? 0;
}

/** Delete in pages until none remain (PostgREST max rows per request). */
async function deleteLike(
  sb: SupabaseClient,
  table: string,
  column: string,
  pattern: string,
): Promise<number> {
  let deleted = 0;
  for (;;) {
    const { data, error: selErr } = await sb.from(table).select('id').like(column, pattern).limit(PAGE);
    if (selErr) throw new Error(`${table} select: ${selErr.message}`);
    if (!data?.length) break;
    const ids = data.map((r) => r.id as string);
    const { error: delErr } = await sb.from(table).delete().in('id', ids);
    if (delErr) throw new Error(`${table} delete: ${delErr.message}`);
    deleted += ids.length;
    if (ids.length < PAGE) break;
  }
  return deleted;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--yes');
  const url = requireEnv('AI_MANAGER_SUPABASE_URL');
  const key = requireEnv('AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY');
  const host = new URL(url).host;
  const sb = createClient(url, key);

  console.log(`[cleanup-e2e] AI Admin host: ${host}`);
  console.log(`[cleanup-e2e] filter: ${E2E_PREFIX} (e2e-test:*, e2e-diag-*, …)`);

  const sessions = await countLike(sb, 'chat_sessions', 'calling_application', E2E_PREFIX);
  const logs = await countLike(sb, 'diagnostic_logs', 'calling_application', E2E_PREFIX);
  const apps = await countLike(sb, 'calling_applications', 'display_name', E2E_PREFIX);
  console.log(`[cleanup-e2e] dry inventory — sessions=${sessions} diagnostic_logs=${logs} calling_applications=${apps}`);

  if (!apply) {
    console.log('[cleanup-e2e] dry-run only. Re-run with --yes to delete these rows.');
    return;
  }

  // Sessions / logs first so calling_applications rows are not left referenced.
  const delSessions = await deleteLike(sb, 'chat_sessions', 'calling_application', E2E_PREFIX);
  const delLogs = await deleteLike(sb, 'diagnostic_logs', 'calling_application', E2E_PREFIX);
  const delApps = await deleteLike(sb, 'calling_applications', 'display_name', E2E_PREFIX);
  console.log(
    `[cleanup-e2e] deleted — sessions=${delSessions} diagnostic_logs=${delLogs} calling_applications=${delApps}`,
  );
}

main().catch((err) => {
  console.error('[cleanup-e2e] failed:', err);
  process.exit(1);
});
