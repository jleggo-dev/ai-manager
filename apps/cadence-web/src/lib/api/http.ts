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

/**
 * A timeout signal for fetches that gate a screen — because a fetch with no signal can hang
 * FOREVER. iOS suspends the webview when the app backgrounds; a request in flight at that moment
 * can come back to a dead socket that never errors and never resolves, and the screen it gates
 * (the app-open skeleton, 2026-08-29 device round) sits there for minutes until the OS happens to
 * notice. A timeout turns that silent hang into a *failure*, which is a thing the query client's
 * retry and the resume hook actually know how to rescue.
 *
 * Guarded because the deployment floor is iOS 15 and `AbortSignal.timeout` arrived with Safari
 * 16 — on an older webview the fetch simply keeps its old behaviour. Never use this on the coach
 * SSE stream: a reply is SUPPOSED to be long-lived.
 */
export function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
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

/**
 * Wake the API while the app is still starting.
 *
 * The Cadence service is serverless and idles out; the first request after that pays a **measured
 * 1.28–1.38s** of service wake before any handler runs (PLAN.md's latency table; re-measured
 * 2026-08-30). For a single-user pre-launch app that idle is the *normal* state, so essentially
 * every launch paid it — and paid it SERIALLY, because the first request could not be sent until
 * Supabase had finished refreshing the access token.
 *
 * `/health` needs no token, so it can go at module load: the wake then happens *during* the token
 * refresh, the bundle parse and the first render instead of after all three. Nothing awaits it and
 * nothing reads its answer — it exists to have already happened.
 *
 * This is not the keep-warm ping PLAN.md still lists as unbuilt (that one needs a scheduler, and
 * Vercel Hobby crons only fire daily). It is the cheaper half: it cannot stop the service going
 * cold, only stop the user waiting alone while it warms.
 */
export function warmApi(): void {
  try {
    void fetch(`${BASE}/health`, { signal: timeoutSignal(10_000) }).catch(() => {});
  } catch {
    /* no fetch, no network, no matter — this is an optimization with no failure mode */
  }
}
