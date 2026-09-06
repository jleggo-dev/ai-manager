/**
 * Who this device is signed in as, read synchronously off disk — with NO Supabase client involved.
 *
 * This lives apart from `supabase.ts` on purpose. That module constructs the auth client at import
 * time, and `createClient` throws outright when the env vars are absent, so anything that imports
 * it inherits both a hard env requirement and the client's whole dependency tree. The boot paint
 * runs before `createRoot` and must not pay either: what it needs is a `JSON.parse` of a string
 * already on the device, and that is all this file is.
 *
 * Keeping it separate is what lets `lib/query`'s barrel stay free of the auth client — a barrel
 * half the app imports should not drag a network client behind it.
 */

const url = import.meta.env.VITE_CADENCE_SUPABASE_URL as string | undefined;

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
  user?: {
    id?: string;
    is_anonymous?: boolean;
    identities?: { provider?: string }[] | null;
    /** When the account was made — the Settings header's WEEK N, printable without the network. */
    created_at?: string;
  };
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
