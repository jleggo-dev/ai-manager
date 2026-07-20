/**
 * Post-merge / post-E2E cleanup for AI Admin leftovers.
 *
 * Deletes ONLY rows clearly tagged as automated test artifacts:
 *   - diagnostic_logs.calling_application LIKE 'e2e%'
 *   - chat_sessions.calling_application LIKE 'e2e%'
 *   - calling_applications.display_name LIKE 'e2e%'
 *   - providers / ai_profiles / processing_jobs matching e2e/lifecycle name patterns
 *     (e.g. "V1 Lifecycle Provider 1784…", "E2E Lock Profile …")
 *
 * Never deletes by provider `type` alone (that would wipe real Devs.ai / Gemini / v2).
 * Never touches production calling apps (e.g. platform:cadence) or real user sessions.
 *
 * Usage (from repo root, PowerShell):
 *   npx tsx backend/scripts/cleanup-e2e-test-data.ts          # dry-run (counts)
 *   npx tsx backend/scripts/cleanup-e2e-test-data.ts --yes    # apply deletes
 *   npx tsx backend/scripts/cleanup-e2e-test-data.ts --yes --soft
 *     # apply, but exit 0 if Supabase env is missing (used after successful tests)
 *
 * Opt out of post-test cleanup: SKIP_TEST_DATA_CLEANUP=1
 *
 * Requires backend/.env: AI_MANAGER_SUPABASE_URL + AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY
 * (unless --soft / SKIP_TEST_DATA_CLEANUP).
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(repoRoot, 'backend/.env') });

const E2E_PREFIX = 'e2e%';
const PAGE = 500;

/**
 * PostgREST `ilike` patterns for ephemeral test names from backend/test/*.
 * Kept as LIKE patterns (not type filters) so legitimate Devs.ai / Gemini / v2 rows stay.
 */
const PROVIDER_NAME_PATTERNS = [
  '%Lifecycle Provider%',
  'E2E % Provider%',
  '% Test Provider%',
  'Updated Provider %',
  'sec-provider %',
  'Tenant Provider %',
  'Enc Test %',
  'pagtest-%',
  'rbac-%',
] as const;

const PROFILE_NAME_PATTERNS = [
  '%Lifecycle Profile%',
  'E2E % Profile%',
  '% Test Profile%',
  'sec-profile %',
  'Tenant Profile %',
  'Bad Provider Profile %',
  'Default Candidate %',
  'HC Profile%',
] as const;

const JOB_NAME_PATTERNS = [
  '%Lifecycle Job%',
  'E2E % Job%',
  '% Test Job%',
  'Cred Required Job %',
  'Creds Job %',
  'Normal Job %',
  'V2 Echo Tool Job %',
  'StepJob %',
] as const;

/** Exact display names that must never be deleted even if a pattern somehow matched. */
const PROTECTED_PROVIDER_NAMES = new Set(['Devs.ai', 'Devs.ai v2', 'Google Gemini']);

function envOrEmpty(name: string): string {
  return process.env[name]?.trim() || '';
}

function requireEnv(name: string): string {
  const v = envOrEmpty(name);
  if (!v) {
    console.error(`Missing ${name} (load backend/.env)`);
    process.exit(1);
  }
  return v;
}

async function countLike(sb: SupabaseClient, table: string, column: string, pattern: string): Promise<number> {
  const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true }).like(column, pattern);
  if (error) throw new Error(`${table} count: ${error.message}`);
  return count ?? 0;
}

/** Delete in pages until none remain (PostgREST max rows per request). */
async function deleteLike(sb: SupabaseClient, table: string, column: string, pattern: string): Promise<number> {
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

type NamedRow = { id: string; name: string };

async function selectByNamePatterns(
  sb: SupabaseClient,
  table: string,
  patterns: readonly string[],
): Promise<NamedRow[]> {
  const byId = new Map<string, NamedRow>();
  for (const pattern of patterns) {
    let offset = 0;
    for (;;) {
      const { data, error } = await sb
        .from(table)
        .select('id, name')
        .ilike('name', pattern)
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(`${table} select (${pattern}): ${error.message}`);
      if (!data?.length) break;
      for (const row of data) {
        byId.set(row.id as string, { id: row.id as string, name: row.name as string });
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
  }
  return [...byId.values()];
}

async function deleteByIds(sb: SupabaseClient, table: string, ids: string[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += PAGE) {
    const chunk = ids.slice(i, i + PAGE);
    const { error } = await sb.from(table).delete().in('id', chunk);
    if (error) throw new Error(`${table} delete by id: ${error.message}`);
    deleted += chunk.length;
  }
  return deleted;
}

function assertNoProtectedProviders(rows: NamedRow[]): void {
  const hit = rows.filter((r) => PROTECTED_PROVIDER_NAMES.has(r.name));
  if (hit.length === 0) return;
  console.error('[cleanup-e2e] ABORT: name patterns matched protected providers:', hit.map((h) => h.name).join(', '));
  process.exit(1);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--yes');
  const soft = process.argv.includes('--soft') || process.env.SKIP_TEST_DATA_CLEANUP === '1';

  if (process.env.SKIP_TEST_DATA_CLEANUP === '1') {
    console.log('[cleanup-e2e] SKIP_TEST_DATA_CLEANUP=1 — skipping');
    return;
  }

  const url = soft ? envOrEmpty('AI_MANAGER_SUPABASE_URL') : requireEnv('AI_MANAGER_SUPABASE_URL');
  const key = soft
    ? envOrEmpty('AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY')
    : requireEnv('AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    console.warn(
      '[cleanup-e2e] soft skip: AI_MANAGER_SUPABASE_URL / AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY not set',
    );
    return;
  }

  const host = new URL(url).host;
  const sb = createClient(url, key);

  console.log(`[cleanup-e2e] AI Admin host: ${host}`);
  console.log(`[cleanup-e2e] filter: ${E2E_PREFIX} (e2e-test:*, e2e-diag-*, …)`);
  console.log('[cleanup-e2e] provider/profile/job name patterns: Lifecycle*, E2E *, * Test *, …');

  const sessions = await countLike(sb, 'chat_sessions', 'calling_application', E2E_PREFIX);
  const logs = await countLike(sb, 'diagnostic_logs', 'calling_application', E2E_PREFIX);
  const apps = await countLike(sb, 'calling_applications', 'display_name', E2E_PREFIX);

  const junkProviders = await selectByNamePatterns(sb, 'providers', PROVIDER_NAME_PATTERNS);
  assertNoProtectedProviders(junkProviders);
  const junkProfiles = await selectByNamePatterns(sb, 'ai_profiles', PROFILE_NAME_PATTERNS);
  const junkJobs = await selectByNamePatterns(sb, 'processing_jobs', JOB_NAME_PATTERNS);

  /* Profiles tied to junk providers but maybe not matching a profile name pattern */
  const junkProviderIds = new Set(junkProviders.map((p) => p.id));
  const { data: linkedProfiles, error: linkErr } = junkProviderIds.size
    ? await sb
        .from('ai_profiles')
        .select('id, name, provider_id')
        .in('provider_id', [...junkProviderIds])
    : { data: [] as { id: string; name: string; provider_id: string }[], error: null };
  if (linkErr) throw new Error(`ai_profiles by provider: ${linkErr.message}`);

  const profileById = new Map<string, NamedRow>();
  for (const p of junkProfiles) profileById.set(p.id, p);
  for (const p of linkedProfiles || []) {
    profileById.set(p.id, { id: p.id, name: p.name });
  }
  const allJunkProfiles = [...profileById.values()];

  console.log(
    `[cleanup-e2e] dry inventory — sessions=${sessions} diagnostic_logs=${logs} calling_applications=${apps}`,
  );
  console.log(
    `[cleanup-e2e] dry inventory — providers=${junkProviders.length} ai_profiles=${allJunkProfiles.length} processing_jobs=${junkJobs.length}`,
  );
  if (junkProviders.length) {
    const sample = junkProviders
      .slice(0, 5)
      .map((p) => p.name)
      .join('; ');
    console.log(`[cleanup-e2e] provider sample: ${sample}${junkProviders.length > 5 ? ' …' : ''}`);
  }

  if (!apply) {
    console.log('[cleanup-e2e] dry-run only. Re-run with --yes to delete these rows.');
    return;
  }

  // Sessions / logs first so calling_applications rows are not left referenced.
  const delSessions = await deleteLike(sb, 'chat_sessions', 'calling_application', E2E_PREFIX);
  const delLogs = await deleteLike(sb, 'diagnostic_logs', 'calling_application', E2E_PREFIX);
  const delApps = await deleteLike(sb, 'calling_applications', 'display_name', E2E_PREFIX);

  // Jobs → profiles → providers. Deleting a provider CASCADE-deletes its ai_profiles
  // (and those CASCADE chat_sessions); jobs referencing profiles become SET NULL.
  // Explicit profile/job deletes still clear name-matched leftovers and orphans.
  const delJobs = await deleteByIds(
    sb,
    'processing_jobs',
    junkJobs.map((j) => j.id),
  );
  const delProfiles = await deleteByIds(
    sb,
    'ai_profiles',
    allJunkProfiles.map((p) => p.id),
  );
  const delProviders = await deleteByIds(
    sb,
    'providers',
    junkProviders.map((p) => p.id),
  );

  console.log(
    `[cleanup-e2e] deleted — sessions=${delSessions} diagnostic_logs=${delLogs} calling_applications=${delApps}`,
  );
  console.log(
    `[cleanup-e2e] deleted — processing_jobs=${delJobs} ai_profiles=${delProfiles} providers=${delProviders}`,
  );
}

main().catch((err) => {
  console.error('[cleanup-e2e] failed:', err);
  process.exit(1);
});
