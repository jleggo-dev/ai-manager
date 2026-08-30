import { createClient } from '@supabase/supabase-js';

/**
 * Cadence's browser Supabase client — used ONLY for auth (sign in/up/out, session). App data never
 * flows through here; it goes through lib/api.ts → the Cadence API (which validates the JWT and
 * talks to Postgres directly). The URL + publishable/anon key are public by design (VITE_ vars).
 * persistSession keeps the user logged in across reloads; the access token rides API calls as a
 * Bearer header (see api.ts).
 */
const url = import.meta.env.VITE_CADENCE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_CADENCE_SUPABASE_ANON_KEY as string | undefined;

export const supabase = createClient(url ?? '', anonKey ?? '', {
  // PKCE (not implicit) so the native iOS shell can finish Google sign-in by exchanging the
  // ?code= from its cadence:// deep link (see lib/native-auth.ts). On web, detectSessionInUrl
  // does the same exchange automatically after the redirect — same flow, two return paths.
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

/** True when the Supabase auth env is present — lets the UI show a clear message if it's not set. */
export const authConfigured = Boolean(url && anonKey);

/**
 * Re-exported so callers that already hold the auth client keep one import. The function itself
 * lives in `persisted-session.ts` and touches no client: importing THIS module constructs one, and
 * the boot paint must not pay that (nor its hard env requirement) just to read a string off disk.
 */
export { readPersistedSession } from './persisted-session.ts';
