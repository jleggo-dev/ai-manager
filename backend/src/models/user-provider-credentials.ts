/**
 * Model – User Provider Credentials
 * -----------------------------------
 * Per-user API keys for LLM providers. Enables each user to
 * authenticate with their own Devs.ai (or other) account so that
 * MCP OAuth tokens (Google, Slack, etc.) are scoped per-user.
 *
 * API keys are encrypted with AES-256-GCM before being written to the
 * database and decrypted at runtime when needed for LLM calls.
 */

import type { ProviderRow, UserProviderCredentialRow } from '../types.ts';
import { tenantFrom, tenantInsertPayload, getAuthContext, effectiveUserId } from '../db/tenant.ts';
import { encryptSecret, decryptSecret } from '../lib/crypto.ts';
import { decryptProviderRow } from './providers.ts';

const TABLE = 'user_provider_credentials';

/** Create or replace a user's credential for a provider. */
export async function upsertUserCredential(
  data: Partial<UserProviderCredentialRow>,
): Promise<UserProviderCredentialRow> {
  if (!data.api_key || typeof data.api_key !== 'string') {
    throw new Error('api_key is required and must be a string');
  }
  const payload: Record<string, unknown> = {
    ...data,
    api_key: encryptSecret(data.api_key),
    updated_at: new Date().toISOString(),
  };
  const { data: row, error } = await tenantFrom(TABLE)
    .upsert(tenantInsertPayload(payload), { onConflict: 'user_id,provider_id,workspace_id' })
    .select()
    .single();
  if (error) throw new Error(`User credential upsert error: ${error.message}`);
  return row;
}

/** Get a specific user's credential for a provider (decrypts the key). */
export async function getUserCredential(userId: string, providerId: string): Promise<UserProviderCredentialRow | null> {
  const { data: row, error } = await tenantFrom(TABLE)
    .select('*')
    .eq('user_id', userId)
    .eq('provider_id', providerId)
    .maybeSingle();
  if (error) throw new Error(`User credential get error: ${error.message}`);
  if (row?.api_key) row.api_key = decryptSecret(row.api_key as string);
  return row;
}

/** List all credentials for the current user (keys are NOT included). */
export async function listUserCredentials(
  userId: string,
): Promise<Omit<UserProviderCredentialRow, 'api_key' | 'workspace_id'>[]> {
  const { data, error } = await tenantFrom(TABLE)
    .select('id, user_id, provider_id, label, metadata, created_at, updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`User credential list error: ${error.message}`);
  return data ?? [];
}

/** Delete a user's credential by id. Always scoped to the effective user. */
export async function deleteUserCredential(id: string): Promise<void> {
  const ctx = getAuthContext();
  const userId = effectiveUserId(ctx);
  if (!userId) throw new Error('User identity required to delete credentials');
  const { error } = await tenantFrom(TABLE).delete().eq('id', id).eq('user_id', userId);
  if (error) throw new Error(`User credential delete error: ${error.message}`);
}

/**
 * Resolve the effective API key for a provider: user-specific key if it exists,
 * otherwise fall back to the provider-level key.
 * The returned key is already decrypted and ready for use.
 */
export async function resolveApiKeyForUser(
  userId: string | null | undefined,
  provider: ProviderRow | null | undefined,
): Promise<string | null | undefined> {
  const providerKey = provider ? decryptProviderRow(provider)?.api_key : undefined;
  if (!userId || !provider?.id) return providerKey;
  const cred = await getUserCredential(userId, provider.id);
  return (cred?.api_key as string | null) || providerKey;
}
