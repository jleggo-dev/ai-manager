import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cadenceConfig } from '../config.ts';

/**
 * User-scoped Supabase client used ONLY to validate a Cadence JWT (auth.getUser)
 * once real auth replaces the dev user. App data does NOT go through here —
 * see db/sql.ts (direct Postgres to the `cadence` schema).
 */
export function cadenceUserClient(accessToken: string): SupabaseClient {
  return createClient(cadenceConfig.supabase.url, cadenceConfig.supabase.anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  });
}

/**
 * Service-role client — SERVER ONLY (never reaches a browser). Used for Supabase Storage
 * (meal photos); app data still goes through db/sql.ts. Lazy singleton: created on first use
 * so environments without the key (e.g. some tests) don't pay or fail at import time.
 */
let service: SupabaseClient | null = null;
export function cadenceServiceClient(): SupabaseClient {
  if (!cadenceConfig.supabase.serviceRoleKey) {
    throw new Error('CADENCE_SUPABASE_SERVICE_ROLE_KEY is not set (required for meal photos)');
  }
  service ??= createClient(cadenceConfig.supabase.url, cadenceConfig.supabase.serviceRoleKey, {
    auth: { persistSession: false },
  });
  return service;
}
