import { waitUntil } from '@vercel/functions';

/**
 * Background work that survives the response — because on Vercel, `void somePromise()` does not.
 *
 * The instant a serverless function's response is sent, the instance is FROZEN. Every
 * fire-and-forget promise still in flight dies with it. Which means the session warm-up
 * (`prefetchImminentSessions`) — written 2026-08-25, "fire-and-forget from BOTH its callers",
 * verified locally where the process outlives the request — had NEVER ONCE RUN in production.
 * Discovered 2026-08-29 on the owner's own account: ~70 pending occurrences across eight days,
 * three sessions warm (the three tapped live, at ~30s each). The backstop that was supposed to
 * self-heal a cold week was killed on every plan load, silently, since the day it shipped.
 *
 * `waitUntil` is the platform's answer: it keeps the invocation alive until the promise settles
 * (bounded by the function's maxDuration — a long warm still gets several sessions further per
 * request, and the next request continues; self-healing, not all-at-once). Outside a Vercel
 * request context (local dev, scripts, tests) there is nothing to extend and nothing to freeze —
 * the guard swallows the absence and the promise runs to completion in the living process.
 *
 * Errors are logged, never thrown: background work must not fail the response it outlived.
 */
export function runInBackground(label: string, work: Promise<unknown>): void {
  const guarded = work.catch((err) => console.error(`[${label}]`, err));
  try {
    waitUntil(guarded);
  } catch {
    /* no request context — the process itself keeps the promise alive */
  }
}
