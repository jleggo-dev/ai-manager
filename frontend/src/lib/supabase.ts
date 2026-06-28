import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          flowType: 'pkce',
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null;

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

/** True when the URL hash indicates a password recovery session from Supabase. */
export function isPasswordRecoveryUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return false;
  const params = new URLSearchParams(hash);
  return params.get('type') === 'recovery';
}

/** Strip Supabase auth hash params after session is consumed (cleaner URL). */
export function clearAuthHashFromUrl(): void {
  if (typeof window === 'undefined') return;
  if (!window.location.hash) return;
  const clean = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(null, '', clean);
}
