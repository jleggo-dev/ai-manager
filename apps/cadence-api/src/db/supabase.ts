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
