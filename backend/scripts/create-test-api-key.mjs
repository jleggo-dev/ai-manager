#!/usr/bin/env node
/**
 * Create (or rotate) an AI Admin API key for automated testing.
 * --------------------------------------------------------------
 * Generates an `aim_sk_…` key scoped to the workspace that owns a Devs.ai
 * provider (so the integration/E2E suites can discover a real Devs.ai chat
 * profile in that workspace), inserts it via the service-role client, and
 * prints the raw secret.
 *
 * Usage (from backend/):  node scripts/create-test-api-key.mjs
 *
 * The raw secret is shown ONCE. Put it in backend/.env as VITE_DEV_API_KEY.
 */
import crypto from 'node:crypto';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config(); // loads ./.env relative to cwd (run from backend/)

const KEY_PREFIX = 'aim_sk_';
const KEY_NAME = 'Automated Test Key';

const url = process.env.AI_MANAGER_SUPABASE_URL;
const serviceRoleKey = process.env.AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error('Missing AI_MANAGER_SUPABASE_URL or AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  process.exit(1);
}

const svc = createClient(url, serviceRoleKey);

function hashApiKeySecret(raw) {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

async function resolveWorkspaceId() {
  /* Prefer the workspace that owns a Devs.ai provider so the test key can
     discover a real Devs.ai chat profile. */
  const { data: devsProvider } = await svc
    .from('providers')
    .select('workspace_id')
    .eq('type', 'devs-ai')
    .limit(1)
    .maybeSingle();
  if (devsProvider?.workspace_id) return devsProvider.workspace_id;

  /* Fall back to the default workspace. */
  const { data: defWs } = await svc.from('workspaces').select('id').eq('slug', 'default').maybeSingle();
  if (defWs?.id) return defWs.id;

  const { data: anyWs } = await svc.from('workspaces').select('id').limit(1).maybeSingle();
  return anyWs?.id ?? null;
}

async function resolveCreatedBy(workspaceId) {
  /* Use an admin/owner member of the workspace so the key inherits a real user. */
  const { data: adminMember } = await svc
    .from('workspace_members')
    .select('user_id, role')
    .eq('workspace_id', workspaceId)
    .in('role', ['owner', 'admin'])
    .limit(1)
    .maybeSingle();
  if (adminMember?.user_id) return adminMember.user_id;

  const { data: anyMember } = await svc
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .limit(1)
    .maybeSingle();
  return anyMember?.user_id ?? null;
}

async function main() {
  const workspaceId = await resolveWorkspaceId();
  if (!workspaceId) {
    console.error('Could not resolve a workspace. Ensure migrations are applied and at least one workspace exists.');
    process.exit(1);
  }
  const createdBy = await resolveCreatedBy(workspaceId);

  /* Best-effort: remove any prior keys with the same name to avoid clutter. */
  await svc.from('api_keys').delete().eq('workspace_id', workspaceId).eq('name', KEY_NAME);

  const raw = `${KEY_PREFIX}${crypto.randomBytes(24).toString('base64url')}`;
  const keyHash = hashApiKeySecret(raw);
  const keyPrefix = raw.slice(0, 16);

  const { data: row, error } = await svc
    .from('api_keys')
    .insert({
      name: KEY_NAME,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      role: 'admin',
      workspace_id: workspaceId,
      created_by: createdBy,
      updated_at: new Date().toISOString(),
    })
    .select('id, name, key_prefix, role, workspace_id')
    .single();
  if (error) {
    console.error('Failed to insert API key:', error.message);
    process.exit(1);
  }

  console.log('\n✅ Test API key created.');
  console.log(`   id:          ${row.id}`);
  console.log(`   name:        ${row.name}`);
  console.log(`   role:        ${row.role}`);
  console.log(`   workspace:   ${row.workspace_id}`);
  console.log(`   created_by:  ${createdBy ?? '(none)'}`);
  console.log('\n   Add this to backend/.env (shown once):');
  console.log(`   VITE_DEV_API_KEY=${raw}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
