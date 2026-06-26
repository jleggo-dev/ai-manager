/**
 * Model – LLM Models
 * --------------------
 * CRUD operations for the `llm_models` table.
 * Stores per-provider model IDs for pure model chat (as opposed to
 * Devs.ai agent UUIDs). Each provider has its own set of available models.
 */

import type { LlmModelRow } from '../types.ts';
import { tenantFrom, tenantInsertPayload } from '../db/tenant.ts';

const TABLE = 'llm_models';

/**
 * List all LLM models for a provider, ordered by category then display_name.
 */
export async function listLlmModels(providerId: string): Promise<LlmModelRow[]> {
  const { data, error } = await tenantFrom(TABLE)
    .select('*')
    .eq('provider_id', providerId)
    .order('category', { ascending: true })
    .order('display_name', { ascending: true });
  if (error) throw new Error(`LLM Models list error: ${error.message}`);
  return data;
}

/**
 * Get a single LLM model by id.
 */
export async function getLlmModel(id: string): Promise<LlmModelRow> {
  const { data: row, error } = await tenantFrom(TABLE).select('*').eq('id', id).single();
  if (error) throw new Error(`LLM Model get error: ${error.message}`);
  return row;
}

/**
 * Create a single LLM model.
 */
export async function createLlmModel(data: Partial<LlmModelRow>): Promise<LlmModelRow> {
  const { data: row, error } = await tenantFrom(TABLE)
    .insert(tenantInsertPayload({ ...data, updated_at: new Date().toISOString() }))
    .select()
    .single();
  if (error) throw new Error(`LLM Model insert error: ${error.message}`);
  return row;
}

interface LlmModelInput {
  model_id: string;
  display_name?: string;
  category?: string;
  is_active?: boolean;
}

/**
 * Bulk-insert LLM models for a provider.
 * Skips duplicates using onConflict (provider_id, model_id).
 */
export async function bulkCreateLlmModels(providerId: string, models: LlmModelInput[]): Promise<LlmModelRow[]> {
  const rows = models.map((m) =>
    tenantInsertPayload({
      provider_id: providerId,
      model_id: m.model_id,
      display_name: m.display_name || m.model_id,
      category: m.category || 'Other',
      is_active: m.is_active !== false,
      updated_at: new Date().toISOString(),
    }),
  );

  const { data, error } = await tenantFrom(TABLE)
    .upsert(rows, { onConflict: 'provider_id,model_id', ignoreDuplicates: true })
    .select();
  if (error) throw new Error(`LLM Models bulk insert error: ${error.message}`);
  return data;
}

/**
 * Update an LLM model record.
 */
export async function updateLlmModel(id: string, updates: Partial<LlmModelRow>): Promise<LlmModelRow> {
  const { data: row, error } = await tenantFrom(TABLE)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`LLM Model update error: ${error.message}`);
  return row;
}

/**
 * Delete an LLM model record by id.
 */
export async function deleteLlmModel(id: string): Promise<void> {
  const { error } = await tenantFrom(TABLE).delete().eq('id', id);
  if (error) throw new Error(`LLM Model delete error: ${error.message}`);
}

/**
 * Count how many models exist for a given provider.
 * Used by the seed function to detect first-run scenarios.
 */
export async function countLlmModels(providerId: string): Promise<number> {
  const { count, error } = await tenantFrom(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('provider_id', providerId);
  if (error) throw new Error(`LLM Models count error: ${error.message}`);
  return count || 0;
}
