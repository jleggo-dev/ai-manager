/**
 * Service-role Supabase client — seeds, bootstrap, API-key lookup, privileged writes.
 * Never attach to end-user requests for tenant CRUD (use tenant.ts + user JWT).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '../config.ts';

let _service: SupabaseClient | null = null;

export function getServiceSupabase(): SupabaseClient {
  if (!_service) {
    const config = getConfig();
    if (!config.aiManagerSupabase.url || !config.aiManagerSupabase.serviceRoleKey) {
      throw new Error('AI_MANAGER_SUPABASE_URL and AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY are required');
    }
    _service = createClient(config.aiManagerSupabase.url, config.aiManagerSupabase.serviceRoleKey);
  }
  return _service;
}

export function _resetServiceSupabaseForTesting(): void {
  if (process.env.NODE_ENV === 'test') _service = null;
}
