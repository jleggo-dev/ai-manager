/**
 * Idempotency key storage — return cached responses on retried requests.
 */

import { getServiceSupabase } from '../db/service-supabase.ts';
import { requireWorkspaceId } from '../db/tenant.ts';

export interface IdempotencyRecord {
  response_body: unknown;
  status_code: number;
}

export async function getIdempotencyRecord(key: string): Promise<IdempotencyRecord | null> {
  const workspaceId = requireWorkspaceId();
  const { data, error } = await getServiceSupabase()
    .from('idempotency_keys')
    .select('response_body, status_code')
    .eq('workspace_id', workspaceId)
    .eq('idempotency_key', key)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) {
    console.warn('[idempotency] lookup failed:', error.message);
    return null;
  }
  return data;
}

export async function storeIdempotencyRecord(
  key: string,
  endpoint: string,
  responseBody: unknown,
  statusCode: number,
  requestHash?: string,
): Promise<void> {
  const workspaceId = requireWorkspaceId();
  const { error } = await getServiceSupabase()
    .from('idempotency_keys')
    .upsert(
      {
        workspace_id: workspaceId,
        idempotency_key: key,
        endpoint,
        request_hash: requestHash || null,
        response_body: responseBody,
        status_code: statusCode,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: 'workspace_id,idempotency_key' },
    );
  if (error) console.warn('[idempotency] store failed:', error.message);
}
