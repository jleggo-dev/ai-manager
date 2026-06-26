/**
 * Model – AI Profiles
 * --------------------
 * CRUD operations for the `ai_profiles` table.
 * AI Profiles reference a specific AI within a Provider (e.g. a Devs.ai AI UUID).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiProfileRow } from '../types.ts';
import { tenantFrom, getAuthContext, tenantInsertPayload } from '../db/tenant.ts';
import { getServiceSupabase } from '../db/service-supabase.ts';

const TABLE = 'ai_profiles';

function supabaseForRpc(): SupabaseClient {
  const ctx = getAuthContext();
  if (ctx?.mode === 'jwt' && ctx.userClient) return ctx.userClient;
  return getServiceSupabase();
}

/** Create a new AI profile. */
export async function createAiProfile(data: Partial<AiProfileRow>): Promise<AiProfileRow> {
  const { data: row, error } = await tenantFrom(TABLE)
    .insert(tenantInsertPayload({ ...data, updated_at: new Date().toISOString() }))
    .select()
    .single();
  if (error) throw new Error(`AI Profile insert error: ${error.message}`);
  return row;
}

/** Update an existing AI profile. */
export async function updateAiProfile(id: string, updates: Partial<AiProfileRow>): Promise<AiProfileRow> {
  const { data: row, error } = await tenantFrom(TABLE)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`AI Profile update error: ${error.message}`);
  return row;
}

/** List AI profiles with cursor-based pagination. Includes provider and failover provider data via join. */
export async function listAiProfiles(
  providerId?: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<AiProfileRow[]> {
  const limit = options.limit || 50;
  let query = tenantFrom(TABLE)
    .select(
      '*, provider:providers!ai_profiles_provider_id_fkey(id, name, type), failover_provider:providers!ai_profiles_failover_provider_id_fkey(id, name, type)',
    )
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (providerId) query = query.eq('provider_id', providerId);
  if (options.cursor) {
    query = query.lt('created_at', options.cursor);
  }
  const { data, error } = await query;
  if (error) throw new Error(`AI Profile list error: ${error.message}`);
  return data || [];
}

/** Get a single AI profile by id, with provider and failover provider data (no secrets). */
export async function getAiProfile(id: string): Promise<AiProfileRow> {
  const { data: row, error } = await tenantFrom(TABLE)
    .select(
      '*, provider:providers!ai_profiles_provider_id_fkey(id, name, type, base_url), failover_provider:providers!ai_profiles_failover_provider_id_fkey(id, name, type, base_url)',
    )
    .eq('id', id)
    .single();
  if (error) throw new Error(`AI Profile get error: ${error.message}`);
  return row;
}

/** Get a single AI profile by id, including provider api_key for internal LLM calls. */
export async function getAiProfileWithKeys(id: string): Promise<AiProfileRow> {
  const { data: row, error } = await tenantFrom(TABLE)
    .select(
      '*, provider:providers!ai_profiles_provider_id_fkey(id, name, type, base_url, api_key), failover_provider:providers!ai_profiles_failover_provider_id_fkey(id, name, type, base_url, api_key)',
    )
    .eq('id', id)
    .single();
  if (error) throw new Error(`AI Profile get error: ${error.message}`);
  return row;
}

/** Delete an AI profile by id. */
export async function deleteAiProfile(id: string): Promise<void> {
  const { error } = await tenantFrom(TABLE).delete().eq('id', id);
  if (error) throw new Error(`AI Profile delete error: ${error.message}`);
}

/**
 * Get the AI profile marked as default (is_default = true).
 * Returns null if no default is set.
 */
export async function getDefaultAiProfile(): Promise<AiProfileRow | null> {
  const { data, error } = await tenantFrom(TABLE)
    .select(
      '*, provider:providers!ai_profiles_provider_id_fkey(id, name, type), failover_provider:providers!ai_profiles_failover_provider_id_fkey(id, name, type)',
    )
    .eq('is_default', true)
    .maybeSingle();
  if (error) throw new Error(`Get default AI profile error: ${error.message}`);
  return data;
}

/**
 * Set a specific profile as the default.
 * Uses an atomic RPC call to clear all other defaults and set the new one
 * in a single transaction, preventing race conditions.
 */
export async function setDefaultAiProfile(id: string): Promise<AiProfileRow> {
  const { data: exists, error: exErr } = await tenantFrom(TABLE).select('id').eq('id', id).maybeSingle();
  if (exErr) throw new Error(`Set default: ${exErr.message}`);
  if (!exists) throw new Error('AI profile not found in this workspace');

  const { error: rpcErr } = await supabaseForRpc().rpc('set_default_ai_profile', { p_profile_id: id });
  if (rpcErr) throw new Error(`Set default (atomic) error: ${rpcErr.message}`);

  const { data: row, error } = await tenantFrom(TABLE).select().eq('id', id).single();
  if (error) throw new Error(`Set default (refetch) error: ${error.message}`);
  return row;
}

/**
 * Clear the default flag on a specific profile.
 */
export async function clearDefaultAiProfile(id: string): Promise<AiProfileRow> {
  const { data: row, error } = await tenantFrom(TABLE)
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`Clear default error: ${error.message}`);
  return row;
}
