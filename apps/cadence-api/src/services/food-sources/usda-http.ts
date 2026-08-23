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

/**
 * A test must not reach the network — and this is enforced here, at the boundary, rather than left
 * to each suite to remember.
 *
 * Two suites were quietly calling live APIs on 2026-08-23. The damage was not the calls: it was
 * that a DB test failed for reasons unrelated to its subject (a real import priced an item and a
 * deliberately low-confidence meal came out non-provisional), and that the calls WROTE SHARED CACHE
 * ROWS which then broke a different suite. `vi.mock` in each file fixes it only until somebody
 * writes the next test that touches pricing, and the failure mode is subtle enough to survive
 * review.
 *
 * So the default under vitest is: no fetch injected, no call. The clients' own tests inject one
 * through the seam below and are unaffected; a deliberate live probe runs under tsx, not vitest.
 * Set ALLOW_NETWORK_IN_TESTS=1 to opt a run back in.
 */
const IN_TEST = !!process.env.VITEST && process.env.ALLOW_NETWORK_IN_TESTS !== '1';
let fetchInjected = false;

let fetchImpl: FetchFn = globalThis.fetch.bind(globalThis);
let inFlight = 0;
let cooldownUntil = 0;
const waiters: Array<() => void> = [];
const singleFlight = new Map<string, Promise<unknown>>();

/** Test seam — inject a mock fetch; resets rate-limit state. */
export function __setUsdaFetchForTests(fn: FetchFn | null): void {
  fetchImpl = fn ?? globalThis.fetch.bind(globalThis);
  fetchInjected = fn !== null;
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

/**
 * FoodData Central is INTERMITTENTLY UNAVAILABLE, and it says so in HTML.
 *
 * Measured 2026-08-23: the same search, repeated eight times, succeeded three. The failures come
 * back as **404 with an Angular error page** — the FDC website, not the API — while api.data.gov
 * still counts the request against the rate limit. Every dataType behaves the same way, so it is
 * the service rather than our query.
 *
 * This had been silently costing us the whole rung. `enrichFoodsWithUsda` swallows failures by
 * design, so a coin-flip outage looked exactly like "no USDA match": whole foods fell through to a
 * pinned guess, and the database held two USDA rows total. Not retrying was a deliberate choice —
 * "a failed lookup is cheap, the next rung answers" — and it was wrong in a way worth naming: it is
 * cheap for CORRECTNESS and expensive for QUALITY, because the rung we lose is the free,
 * permanently-cacheable, public-domain one.
 *
 * The discriminator is content-type. A genuine API answer — including a real 404 for an fdcId that
 * does not exist — arrives as JSON. An HTML body means the request never reached the API.
 */
const RETRY_DELAYS_MS = [200, 600];

function isTransport(res: Response): boolean {
  return res.status >= 500 || (res.status === 404 && !(res.headers.get('content-type') ?? '').includes('json'));
}

async function fetchWithRetries(url: string, init?: RequestInit): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]!);
    try {
      const res = await fetchImpl(url, init ?? { method: 'GET', headers: { Accept: 'application/json' } });
      if (!isTransport(res)) return res;
      last = res;
    } catch (e) {
      if (attempt === RETRY_DELAYS_MS.length) throw e;
    }
  }
  return last as Response;
}

async function rawUsdaCall(pathAndQuery: string, body?: unknown): Promise<unknown> {
  const key = requireApiKey();
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const url = `${USDA_BASE}${pathAndQuery}${sep}api_key=${encodeURIComponent(key)}`;

  if (IN_TEST && !fetchInjected) {
    throw new UsdaHttpError(
      0,
      'refusing to call USDA from a test — inject a fetch with __setUsdaFetchForTests, ' +
        'or mock services/food-sources/usda-enrich.ts',
    );
  }

  await acquireSlot();
  try {
    const res = await fetchWithRetries(
      url,
      body === undefined
        ? undefined
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(body),
          },
    );
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

  const promise = rawUsdaCall(pathAndQuery).finally(() => {
    singleFlight.delete(pathAndQuery);
  });
  singleFlight.set(pathAndQuery, promise);
  return promise;
}

/**
 * POST the same API — how SEARCH must be issued, because one dataType cannot survive a query string.
 *
 * `Survey (FNDDS)` is the documented name of USDA's survey dataset and FDC returns it in results,
 * but sending it as a `dataType` GET parameter is a hard 400 in EVERY encoding — literal parens,
 * %28/%29, plus-space, comma-joined. Their query parser simply will not take it, and the failure
 * is total: the whole search 400s, so adding FNDDS to the list silently broke every whole-food
 * lookup. The POST form takes `dataType` as a JSON array and works first time.
 *
 * Found the day it shipped, by an unrelated end-to-end run — NOT by the smoke sweep, which called
 * search without dataTypes and so never exercised the gate the app actually uses. The sweep now
 * goes through `searchUsdaFoods` for that reason.
 *
 * Single-flight is keyed on path + body so two identical searches still collapse into one call.
 */
export async function usdaPost(path: string, body: unknown): Promise<unknown> {
  const key = `${path}::${JSON.stringify(body)}`;
  const existing = singleFlight.get(key);
  if (existing) return existing;

  const promise = rawUsdaCall(path, body).finally(() => {
    singleFlight.delete(key);
  });
  singleFlight.set(key, promise);
  return promise;
}
