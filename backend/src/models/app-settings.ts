/**
 * Model – App Settings
 * ---------------------
 * CRUD for `app_settings` (composite PK workspace_id + key).
 */

import type { AppSettingRow } from '../types.ts';
import { tenantFrom, tenantInsertPayload } from '../db/tenant.ts';

const TABLE = 'app_settings';

/** Get all settings for the current workspace. */
export async function listSettings(): Promise<AppSettingRow[]> {
  const { data, error } = await tenantFrom(TABLE).select('*').order('key').limit(1000);
  if (error) throw new Error(`Settings list error: ${error.message}`);
  return data || [];
}

/** Get a single setting by key. Returns null if not found. */
export async function getSetting(key: string): Promise<AppSettingRow | null> {
  const { data, error } = await tenantFrom(TABLE).select('*').eq('key', key).maybeSingle();
  if (error) throw new Error(`Settings get error: ${error.message}`);
  return data;
}

/**
 * Upsert a setting for the current workspace.
 */
export async function upsertSetting(key: string, value: unknown, description?: string): Promise<AppSettingRow> {
  const payload: Record<string, unknown> = tenantInsertPayload({
    key,
    value,
    updated_at: new Date().toISOString(),
  });
  if (description !== undefined) payload.description = description;

  const { data: row, error } = await tenantFrom(TABLE)
    .upsert(payload, { onConflict: 'workspace_id,key' })
    .select()
    .single();
  if (error) throw new Error(`Settings upsert error: ${error.message}`);
  return row;
}

/** Delete a setting by key in the current workspace. */
export async function deleteSetting(key: string): Promise<void> {
  const { error } = await tenantFrom(TABLE).delete().eq('key', key);
  if (error) throw new Error(`Settings delete error: ${error.message}`);
}
