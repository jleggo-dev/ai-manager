/**
 * Shared helpers for AI Admin backend e2e suites.
 *
 * Live Devs.ai round-trips can exceed the default 60s vitest timeout under
 * CI load; soft cleanup from a parallel Actions job used to wipe in-flight
 * `e2e%` rows — prefer age-gated cleanup (see cleanup-e2e-test-data.ts) over
 * skipping these suites.
 */

/** Vitest timeout for tests that await a full live SSE / LLM response. */
export const LIVE_SSE_TEST_TIMEOUT_MS = 180_000;

/** Superagent deadline so a hung upstream fails with a clear timeout, not a silent hang. */
export const LIVE_SSE_REQUEST_TIMEOUT_MS = 150_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async operation on transient failures (network / 5xx / timeout).
 * Does not retry on assertion failures thrown by the caller after a settled response.
 */
export async function retryTransient<T>(
  label: string,
  fn: () => Promise<T>,
  options: { attempts?: number; delayMs?: number; shouldRetry?: (err: unknown) => boolean } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 1500;
  const shouldRetry =
    options.shouldRetry ??
    ((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      return /timeout|ECONNRESET|ETIMEDOUT|socket hang up|503|502|504/i.test(msg);
    });

  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i >= attempts || !shouldRetry(err)) throw err;
      console.warn(`[e2e] ${label}: attempt ${i}/${attempts} failed (${err}); retrying…`);
      await sleep(delayMs * i);
    }
  }
  throw lastErr;
}
