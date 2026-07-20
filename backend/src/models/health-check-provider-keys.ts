/**
 * Model – Health Check Provider Keys
 * ------------------------------------
 * CRUD for health_check_provider_keys (encrypted API keys used by the checker).
 */

import { tenantFrom, tenantInsertPayload, getAuthContext, effectiveUserId, requireWorkspaceId } from '../db/tenant.ts';
import { getServiceSupabase } from '../db/service-supabase.ts';
import { encryptSecret, decryptSecret } from '../lib/crypto.ts';
import type { HealthCheckProviderKeyRow } from '../types.ts';

async function resolveUserId(): Promise<string> {
  const uid = effectiveUserId(getAuthContext());
  if (uid) return uid;

  const wsId = requireWorkspaceId();
  const { data } = await getServiceSupabase()
    .from('workspace_members')
    .select('user_id, role')
    .eq('workspace_id', wsId)
    .in('role', ['owner', 'admin'])
    .order('role', { ascending: true })
    .limit(1)
    .single();
  if (data?.user_id) return data.user_id as string;

  throw new Error('Cannot determine user identity for provider key ownership');
}

function decryptKeyRow(row: HealthCheckProviderKeyRow): HealthCheckProviderKeyRow {
  if (row?.api_key) {
    try {
      return { ...row, api_key: decryptSecret(row.api_key) };
    } catch {
      return row;
    }
  }
  return row;
}

export async function createProviderKey(data: Partial<HealthCheckProviderKeyRow>): Promise<HealthCheckProviderKeyRow> {
  const userId = await resolveUserId();
  const payload: Record<string, unknown> = { ...data, user_id: userId, updated_at: new Date().toISOString() };
  if (payload.api_key) payload.api_key = encryptSecret(payload.api_key as string);
  const { data: row, error } = await tenantFrom('health_check_provider_keys')
    .insert(tenantInsertPayload(payload))
    .select('*, provider:providers(*)')
    .single();
  if (error) throw new Error(`HC provider key insert error: ${error.message}`);
  return decryptKeyRow(row);
}

export async function updateProviderKey(
  id: string,
  updates: Partial<HealthCheckProviderKeyRow>,
): Promise<HealthCheckProviderKeyRow> {
  const payload: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() };
  if (payload.api_key) payload.api_key = encryptSecret(payload.api_key as string);
  const { data: row, error } = await tenantFrom('health_check_provider_keys')
    .update(payload)
    .eq('id', id)
    .select('*, provider:providers(*)')
    .single();
  if (error) throw new Error(`HC provider key update error: ${error.message}`);
  return decryptKeyRow(row);
}

export async function listProviderKeys(): Promise<HealthCheckProviderKeyRow[]> {
  const { data, error } = await tenantFrom('health_check_provider_keys')
    .select('*, provider:providers(*)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`HC provider key list error: ${error.message}`);
  return (data || []).map(decryptKeyRow);
}

export async function getProviderKey(id: string): Promise<HealthCheckProviderKeyRow> {
  const { data: row, error } = await tenantFrom('health_check_provider_keys')
    .select('*, provider:providers(*)')
    .eq('id', id)
    .single();
  if (error) throw new Error(`HC provider key get error: ${error.message}`);
  return decryptKeyRow(row);
}

export async function deleteProviderKey(id: string): Promise<void> {
  const { error } = await tenantFrom('health_check_provider_keys').delete().eq('id', id);
  if (error) throw new Error(`HC provider key delete error: ${error.message}`);
}
