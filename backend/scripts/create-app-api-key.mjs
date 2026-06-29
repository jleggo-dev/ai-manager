#!/usr/bin/env node
/**
 * Create (or rotate) an AI Admin API key for an external calling application.
 * --------------------------------------------------------------------------
 * Generates an `aim_sk_…` key scoped to a real workspace and inserts it via the
 * service-role client, then prints the raw secret ONCE.
 *
 * Usage (from backend/):
 *   node scripts/create-app-api-key.mjs <appName> [role]
 *   node scripts/create-app-api-key.mjs lifestyle-app admin
 *
 * The raw secret is shown ONCE. Put it in the consuming app's server-side .env
 * as AI_ADMIN_API_KEY (never a client-side VITE_ variable).
 */
import crypto from 'node:crypto';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config(); // loads ./.env relative to cwd (run from backend/)

const KEY_PREFIX = 'aim_sk_';
const APP_NAME = process.argv[2] || 'lifestyle-app';
const ROLE = process.argv[3] || 'admin';
const KEY_NAME = `${APP_NAME} (app key)`;

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
  /* Prefer the workspace that owns a Devs.ai provider so the app can reach a
     real chat profile; fall back to the default/first workspace. */
  const { data: devsProvider } = await svc
    .from('providers')
    .select('workspace_id')
    .eq('type', 'devs-ai')
    .limit(1)
    .maybeSingle();
  if (devsProvider?.workspace_id) return devsProvider.workspace_id;

  const { data: defWs } = await svc.from('workspaces').select('id').eq('slug', 'default').maybeSingle();
  if (defWs?.id) return defWs.id;

  const { data: anyWs } = await svc.from('workspaces').select('id').limit(1).maybeSingle();
  return anyWs?.id ?? null;
}

async function resolveCreatedBy(workspaceId) {
  /* Attribute the key to an admin/owner member so it inherits a real user. */
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

  /* Best-effort: remove any prior key with the same name to avoid clutter / rotate. */
  try {
    await svc.from('api_keys').delete().eq('workspace_id', workspaceId).eq('name', KEY_NAME);
  } catch (err) {
    console.warn(`Warning: could not clean up prior "${KEY_NAME}" keys: ${err.message}`);
  }

  const raw = `${KEY_PREFIX}${crypto.randomBytes(24).toString('base64url')}`;
  const keyHash = hashApiKeySecret(raw);
  const keyPrefix = raw.slice(0, 16);

  const { data: row, error } = await svc
    .from('api_keys')
    .insert({
      name: KEY_NAME,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      role: ROLE,
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

  console.log('\nAI Admin API key created.');
  console.log(`   id:          ${row.id}`);
  console.log(`   name:        ${row.name}`);
  console.log(`   role:        ${row.role}`);
  console.log(`   workspace:   ${row.workspace_id}`);
  console.log(`   created_by:  ${createdBy ?? '(none)'}`);
  console.log('\n   Add this to the app server-side .env (shown once):');
  console.log(`   AI_ADMIN_API_KEY=${raw}`);
  /* Marker line for tooling/automation to parse the raw secret. */
  console.log(`RAW_KEY=${raw}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
