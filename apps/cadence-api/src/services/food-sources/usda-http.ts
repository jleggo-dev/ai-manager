/**
 * Rate-limited USDA FoodData Central HTTP client.
 * Process-local: single-flight + concurrency cap + 429 cooldown (anti-stampede).
 * Not a distributed limiter — good enough for thousands of users with aggressive caching.
 */
import { cadenceConfig } from '../../config.ts';

const USDA_BASE = 'https://api.nal.usda.gov/fdc/v1';
const MAX_IN_FLIGHT = 2;
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 5 * 60_000;

export class UsdaConfigError extends Error {
  constructor(message = 'USDA FoodData Central is not configured') {
    super(message);
    this.name = 'UsdaConfigError';
  }
}

export class UsdaHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'UsdaHttpError';
    this.status = status;
  }
}

export function isUsdaConfigured(): boolean {
  return Boolean(cadenceConfig.usdaApiKey?.trim());
}

function requireApiKey(): string {
  const key = cadenceConfig.usdaApiKey?.trim();
  if (!key) throw new UsdaConfigError();
  return key;
}

type FetchFn = typeof fetch;

let fetchImpl: FetchFn = globalThis.fetch.bind(globalThis);
let inFlight = 0;
let cooldownUntil = 0;
const waiters: Array<() => void> = [];
const singleFlight = new Map<string, Promise<unknown>>();

/** Test seam — inject a mock fetch; resets rate-limit state. */
export function __setUsdaFetchForTests(fn: FetchFn | null): void {
  fetchImpl = fn ?? globalThis.fetch.bind(globalThis);
  inFlight = 0;
  cooldownUntil = 0;
  waiters.length = 0;
  singleFlight.clear();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireSlot(): Promise<void> {
  const now = Date.now();
  if (cooldownUntil > now) await sleep(cooldownUntil - now);

  if (inFlight >= MAX_IN_FLIGHT) {
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
    // Re-check cooldown after waking (429 may have fired while queued).
    const again = Date.now();
    if (cooldownUntil > again) await sleep(cooldownUntil - again);
  }
  inFlight += 1;
}

function releaseSlot(): void {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiters.shift();
  if (next) next();
}

function applyCooldown(res: Response): void {
  const retryAfter = res.headers.get('retry-after');
  let ms = DEFAULT_COOLDOWN_MS;
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs > 0) ms = Math.min(MAX_COOLDOWN_MS, secs * 1000);
  }
  cooldownUntil = Math.max(cooldownUntil, Date.now() + ms);
  console.warn(`[usda] rate limited (429); cooling down ${ms}ms`);
}

async function rawUsdaGet(pathAndQuery: string): Promise<unknown> {
  const key = requireApiKey();
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const url = `${USDA_BASE}${pathAndQuery}${sep}api_key=${encodeURIComponent(key)}`;

  await acquireSlot();
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (res.status === 429) {
      applyCooldown(res);
      throw new UsdaHttpError(429, 'USDA rate limit exceeded — try again shortly');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[usda] HTTP ${res.status} for ${pathAndQuery.split('?')[0]}: ${body.slice(0, 200)}`);
      throw new UsdaHttpError(res.status, `USDA request failed (${res.status})`);
    }
    return (await res.json()) as unknown;
  } finally {
    releaseSlot();
  }
}

/**
 * GET with single-flight coalescing: concurrent identical paths share one HTTP call.
 * Path must NOT include api_key.
 */
export async function usdaGet(pathAndQuery: string): Promise<unknown> {
  const existing = singleFlight.get(pathAndQuery);
  if (existing) return existing;

  const promise = rawUsdaGet(pathAndQuery).finally(() => {
    singleFlight.delete(pathAndQuery);
  });
  singleFlight.set(pathAndQuery, promise);
  return promise;
}
