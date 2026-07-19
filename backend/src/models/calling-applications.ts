/**
 * Model – Calling Applications
 * ------------------------------
 * Lightweight registry of applications that call AI Admin.
 * Auto-populated on first API call; admins can rename via display_name.
 */

import type { CallingApplicationRow, RequestAuthContext } from '../types.ts';
import { tenantFrom, tenantInsertPayload } from '../db/tenant.ts';

const TABLE = 'calling_applications';

/** List calling applications with cursor-based pagination. */
export async function listCallingApplications(
  options: { cursor?: string; limit?: number } = {},
): Promise<CallingApplicationRow[]> {
  const limit = options.limit || 50;
  let query = tenantFrom(TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (options.cursor) {
    query = query.lt('created_at', options.cursor);
  }
  const { data, error } = await query;
  if (error) throw new Error(`Calling applications list error: ${error.message}`);
  return data || [];
}

/** Get a single calling application by id (TEXT PK). */
export async function getCallingApplication(id: string): Promise<CallingApplicationRow | null> {
  const { data: row, error } = await tenantFrom(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Calling application get error: ${error.message}`);
  return row;
}

/**
 * Upsert a calling application. If the id already exists, this is a no-op
 * (display_name is only set on insert; admins rename explicitly).
 *
 * `ignoreDuplicates: true` makes Postgres run `ON CONFLICT DO NOTHING`, which
 * returns zero rows on a conflict — `.select().single()` would then throw a
 * PGRST "cannot coerce to a single JSON object" error even though the upsert
 * itself succeeded. Fetch the existing row explicitly in that case instead.
 */
export async function upsertCallingApplication(id: string, displayName?: string): Promise<CallingApplicationRow> {
  const { data: rows, error } = await tenantFrom(TABLE)
    .upsert(tenantInsertPayload({ id, display_name: displayName || id }), {
      onConflict: 'workspace_id,id',
      ignoreDuplicates: true,
    })
    .select();
  if (error) throw new Error(`Calling application upsert error: ${error.message}`);
  if (rows && rows.length > 0) return rows[0];

  const existing = await getCallingApplication(id);
  if (existing) return existing;
  throw new Error(`Calling application upsert error: no row returned or found for id "${id}"`);
}

/** Update display_name (admin rename). */
export async function updateCallingApplication(
  id: string,
  updates: Partial<CallingApplicationRow>,
): Promise<CallingApplicationRow | null> {
  const payload: Record<string, unknown> = {};
  if (updates.display_name != null) payload.display_name = updates.display_name;
  if (Object.keys(payload).length === 0) return getCallingApplication(id);

  const { data: row, error } = await tenantFrom(TABLE).update(payload).eq('id', id).select().single();
  if (error) throw new Error(`Calling application update error: ${error.message}`);
  return row;
}

/** Delete a calling application (nulls out FK on jobs via application code). */
export async function deleteCallingApplication(id: string): Promise<void> {
  const { error } = await tenantFrom(TABLE).delete().eq('id', id);
  if (error) throw new Error(`Calling application delete error: ${error.message}`);
}

/**
 * Resolve the calling application identity from the best available source.
 * Priority: API key link (tamper-proof) > explicit body field > error.
 * Throws if neither source provides a value.
 */
export function resolveCallingApplication(ctx: RequestAuthContext | null | undefined, bodyField?: string): string {
  if (ctx?.mode === 'api_key' && ctx.callingApplicationId) {
    return ctx.callingApplicationId;
  }
  if (bodyField?.trim()) {
    if (ctx?.mode === 'api_key') {
      console.warn(
        `[calling-apps] API key ${ctx.apiKeyId} has no linked calling_application_id; using body field "${bodyField.trim()}" (unverified).`,
      );
    }
    return bodyField.trim();
  }
  throw new Error(
    'callingApplication is required. Provide it in the request body, or ask your admin to link this API key to a calling application.',
  );
}
