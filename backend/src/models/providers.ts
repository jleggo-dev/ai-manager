/**
 * Model – Providers
 * ------------------
 * CRUD operations for the `providers` table.
 * Providers represent LLM platforms (Devs.ai, OpenAI, Anthropic, etc.).
 */

import type { ProviderRow } from '../types.ts';
import { tenantFrom, tenantInsertPayload } from '../db/tenant.ts';
import { encryptSecret, decryptSecret } from '../lib/crypto.ts';

const TABLE = 'providers';

function decryptRow(row: ProviderRow): ProviderRow {
  if (row?.api_key) {
    try {
      return { ...row, api_key: decryptSecret(row.api_key) };
    } catch {
      return row;
    }
  }
  return row;
}

/** Decrypt api_key on a provider row (joins / nested selects skip model-layer decrypt). */
export function decryptProviderRow(row: ProviderRow | null | undefined): ProviderRow | null | undefined {
  if (!row) return row ?? null;
  return decryptRow(row);
}

/** Create a new provider. */
export async function createProvider(data: Partial<ProviderRow>): Promise<ProviderRow> {
  const payload: Record<string, unknown> = { ...data, updated_at: new Date().toISOString() };
  if (payload.api_key) payload.api_key = encryptSecret(payload.api_key as string);
  const { data: row, error } = await tenantFrom(TABLE).insert(tenantInsertPayload(payload)).select().single();
  if (error) throw new Error(`Provider insert error: ${error.message}`);
  return decryptRow(row);
}

/** Update an existing provider. */
export async function updateProvider(id: string, updates: Partial<ProviderRow>): Promise<ProviderRow> {
  const payload: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() };
  if (payload.api_key) payload.api_key = encryptSecret(payload.api_key as string);
  const { data: row, error } = await tenantFrom(TABLE).update(payload).eq('id', id).select().single();
  if (error) throw new Error(`Provider update error: ${error.message}`);
  return decryptRow(row);
}

/** List providers with cursor-based pagination. */
export async function listProviders(options: { cursor?: string; limit?: number } = {}): Promise<ProviderRow[]> {
  const limit = options.limit || 50;
  let query = tenantFrom(TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (options.cursor) {
    query = query.lt('created_at', options.cursor);
  }
  const { data, error } = await query;
  if (error) throw new Error(`Provider list error: ${error.message}`);
  return (data || []).map(decryptRow);
}

/** Get a single provider by id. */
export async function getProvider(id: string): Promise<ProviderRow> {
  const { data: row, error } = await tenantFrom(TABLE).select('*').eq('id', id).single();
  if (error) throw new Error(`Provider get error: ${error.message}`);
  return decryptRow(row);
}

/** Delete a provider by id. */
export async function deleteProvider(id: string): Promise<void> {
  const { error } = await tenantFrom(TABLE).delete().eq('id', id);
  if (error) throw new Error(`Provider delete error: ${error.message}`);
}
