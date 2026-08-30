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
 * Where supabase-js keeps the session on this device. Derived, not configured: passing our own
 * `storageKey` to `createClient` would rename the key and sign everyone out on the build that did
 * it. This mirrors the library's own default (`sb-<project-ref>-auth-token`) and is read-only —
 * the client still owns every write.
 */
function sessionStorageKey(): string | null {
  try {
    return url ? `sb-${new URL(url).hostname.split('.')[0]}-auth-token` : null;
  } catch {
    return null;
  }
}

/**
 * The session already on disk, read synchronously — who this device is signed in as, without
 * asking the network.
 *
 * `supabase.auth.getSession()` is the authoritative answer and it stays the one the app runs on.
 * But it is also a PROMISE that awaits a token refresh whenever the access token has aged out (an
 * hour by default — so most launches), and until it settles the app has nothing to render but a
 * skeleton. That is a network round trip standing between a user and pixels that are already on
 * the device.
 *
 * This is for the PAINT, and for nothing else. It never authorizes a request — the token it can
 * see may well be expired, which is precisely why `getSession()` exists — it answers only "is
 * somebody signed in here, and who", so the first frame can be their screen instead of a loading
 * state. Every failure mode (no key, unreadable store, a shape from another library version)
 * returns null, which falls back to exactly the behaviour that shipped before it.
 */
export function readPersistedSession(): {
  user?: { id?: string; is_anonymous?: boolean; identities?: { provider?: string }[] | null };
} | null {
  try {
    const key = sessionStorageKey();
    const raw = key ? window.localStorage.getItem(key) : null;
    if (!raw) return null;
    // supabase-js base64-encodes the blob on some paths; both forms decode to the same JSON.
    const json = raw.startsWith('base64-') ? atob(raw.slice(7)) : raw;
    const parsed = JSON.parse(json) as { user?: { id?: string } } | null;
    return parsed?.user?.id ? parsed : null;
  } catch {
    return null;
  }
}
