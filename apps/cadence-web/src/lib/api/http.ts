/**
 * Shared HTTP plumbing for the Cadence API client.
 * NEVER calls AI Admin directly and NEVER holds aim_sk_.
 */

export const BASE = import.meta.env.VITE_CADENCE_API_BASE ?? '/api';

let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}

/**
 * Dev-only account selector (real auth deferred). Two interchangeable scratch accounts, chosen
 * via the X-Cadence-Dev-User header; the backend maps the slug to a fixed user id (allowlisted
 * server-side). No effect once real auth lands.
 *
 * Lives with HTTP auth because `headers()` must resolve the active account without a cycle
 * into the x-ray/reset surface in `dev.ts`.
 */
const ACCOUNT_KEY = 'cadence.devAccount';
export const DEV_ACCOUNTS = ['account-1', 'account-2'] as const;
export type DevAccount = (typeof DEV_ACCOUNTS)[number];
export const DEV_ACCOUNT_LABELS: Record<DevAccount, string> = {
  'account-1': 'Account 1',
  'account-2': 'Account 2',
};
export function getDevAccount(): DevAccount {
  const a = localStorage.getItem(ACCOUNT_KEY);
  return (DEV_ACCOUNTS as readonly string[]).includes(a ?? '') ? (a as DevAccount) : 'account-1';
}
export function setDevAccount(a: DevAccount) {
  localStorage.setItem(ACCOUNT_KEY, a);
}

/**
 * Dev mode = `?dev=1` in the URL. In dev mode the app skips real auth and talks to the backend as
 * a named dev account (via X-Cadence-Dev-User); otherwise it sends the Supabase JWT as a Bearer
 * token. Read straight from the URL so it needs no wiring — the backend independently ignores the
 * dev header in production (CADENCE_DEV_USER_ID unset), so this can't be a prod auth bypass.
 */
export function isDevMode(): boolean {
  return new URLSearchParams(window.location.search).get('dev') === '1';
}

/**
 * The browser's IANA zone, on every request.
 *
 * The server decides "today" for the whole Plan screen, and it used UTC — so at 20:41 on a
 * Tuesday in Montreal it served Wednesday, label and occurrences both. The stored timezone fixes
 * that for anyone who has one; 94 of 96 rows do not, and this is how they get one without asking.
 */
function tzHeader(): Record<string, string> {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz ? { 'X-Cadence-Timezone': tz } : {};
  } catch {
    return {};
  }
}

export function headers(): HeadersInit {
  // Dev mode → identify as a named dev account (no real auth). Otherwise → the Supabase JWT.
  // Sending only one keeps the backend's two paths unambiguous.
  if (isDevMode()) {
    return { 'Content-Type': 'application/json', 'X-Cadence-Dev-User': getDevAccount(), ...tzHeader() };
  }
  return {
    'Content-Type': 'application/json',
    ...tzHeader(),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  };
}

/**
 * "Start over" — wipe THIS user's Cadence data (real-auth allowed; server re-verifies the typed
 * phrase). NOT account deletion: the login survives. In dev mode the Reset button uses /dev/reset.
 */
export async function deleteMyData(confirmPhrase: string): Promise<boolean> {
  const res = await fetch(`${BASE}/me/data`, {
    method: 'DELETE',
    headers: headers(),
    body: JSON.stringify({ confirm: confirmPhrase }),
  });
  return res.ok;
}
