/**
 * FatSecret Platform API client — OAuth 1.0, rate-limited, process-local.
 *
 * WHY 1.0 AND NOT 2.0. FatSecret's OAuth 2.0 flow requires registering the caller's IP address,
 * and this API runs on Vercel serverless: dynamic egress, no fixed address to register. OAuth 1.0
 * signs every request with the consumer secret instead, so it authenticates from anywhere. That is
 * the whole reason this file does signature work a bearer token would have avoided (owner,
 * 2026-08-22).
 *
 * Two-legged: there is no user to authorise, so the token and token secret are empty and the
 * signing key is `consumerSecret&`.
 *
 * Same anti-stampede shape as `usda-http.ts` — single-flight coalescing, an in-flight cap, and a
 * 429 cooldown — because the failure mode is identical: many users resolving the same lunch.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { cadenceConfig } from '../../config.ts';

const FATSECRET_BASE = 'https://platform.fatsecret.com/rest/server.api';
const MAX_IN_FLIGHT = 2;
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 5 * 60_000;

/**
 * FatSecret's throttling codes. These arrive as **HTTP 200 with an error body**, not as 429, so
 * they never reach the status check below — which meant that before 2026-08-23 exhausting the
 * daily quota produced a failed call on every subsequent pricing, forever, with no back-off.
 *
 *   11 — "Application request limit reached" (the tier's DAILY cap; Basic allows 5,000)
 *   12 — "User is performing too many actions" (a transient per-user throttle)
 */
const ERR_APP_LIMIT = 11;
const ERR_USER_THROTTLE = 12;

export class FatSecretConfigError extends Error {
  constructor(message = 'FatSecret is not configured') {
    super(message);
    this.name = 'FatSecretConfigError';
  }
}

export class FatSecretHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'FatSecretHttpError';
    this.status = status;
  }
}

export function isFatSecretConfigured(): boolean {
  return Boolean(cadenceConfig.fatSecret.consumerKey?.trim() && cadenceConfig.fatSecret.consumerSecret?.trim());
}

function credentials(): { key: string; secret: string } {
  const key = cadenceConfig.fatSecret.consumerKey?.trim();
  const secret = cadenceConfig.fatSecret.consumerSecret?.trim();
  if (!key || !secret) throw new FatSecretConfigError();
  return { key, secret };
}

/**
 * RFC 5849 percent-encoding. `encodeURIComponent` leaves !*'() alone and OAuth requires them
 * escaped — a signature computed with the built-in encoder alone fails on any query containing
 * an apostrophe, which for a food search is a matter of time ("Trader Joe's").
 */
function pctEncode(v: string): string {
  return encodeURIComponent(v).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** The OAuth 1.0 signature base string + HMAC-SHA1, over every parameter including the method's. */
export function signRequest(
  params: Record<string, string>,
  consumerKey: string,
  consumerSecret: string,
  opts: { nonce?: string; timestamp?: string; url?: string; httpMethod?: string } = {},
): Record<string, string> {
  const all: Record<string, string> = {
    ...params,
    oauth_consumer_key: consumerKey,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: opts.timestamp ?? Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: opts.nonce ?? randomBytes(16).toString('hex'),
    oauth_version: '1.0',
  };

  // Sorted by encoded key, then encoded value — the order is part of the signature.
  const normalized = Object.keys(all)
    .map((k) => [pctEncode(k), pctEncode(all[k] ?? '')] as const)
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const base = [
    (opts.httpMethod ?? 'GET').toUpperCase(),
    pctEncode(opts.url ?? FATSECRET_BASE),
    pctEncode(normalized),
  ].join('&');

  // Two-legged: no token secret, but the separator is still required.
  const signingKey = `${pctEncode(consumerSecret)}&`;
  all.oauth_signature = createHmac('sha1', signingKey).update(base).digest('base64');
  return all;
}

type FetchFn = typeof fetch;

let fetchImpl: FetchFn = globalThis.fetch.bind(globalThis);
let inFlight = 0;
let cooldownUntil = 0;
const waiters: Array<() => void> = [];
const singleFlight = new Map<string, Promise<unknown>>();

/** Test seam — inject a mock fetch; resets rate-limit state. */
export function __setFatSecretFetchForTests(fn: FetchFn | null): void {
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

function applyCooldown(reason: string, res?: Response, fallbackMs = DEFAULT_COOLDOWN_MS): void {
  const retryAfter = res?.headers.get('retry-after');
  let ms = fallbackMs;
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs > 0) ms = Math.min(MAX_COOLDOWN_MS, secs * 1000);
  }
  cooldownUntil = Math.max(cooldownUntil, Date.now() + ms);
  console.warn(`[fatsecret] ${reason}; cooling down ${ms}ms`);
}

async function rawCall(params: Record<string, string>): Promise<unknown> {
  const { key, secret } = credentials();
  const signed = signRequest({ ...params, format: 'json' }, key, secret);
  const query = Object.keys(signed)
    .map((k) => `${pctEncode(k)}=${pctEncode(signed[k] ?? '')}`)
    .join('&');

  await acquireSlot();
  try {
    const res = await fetchImpl(`${FATSECRET_BASE}?${query}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (res.status === 429) {
      applyCooldown('rate limited (429)', res);
      throw new FatSecretHttpError(429, 'FatSecret rate limit exceeded — try again shortly');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[fatsecret] HTTP ${res.status} for ${params.method}: ${body.slice(0, 200)}`);
      throw new FatSecretHttpError(res.status, `FatSecret request failed (${res.status})`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    /**
     * FatSecret answers application errors with HTTP 200 and an `error` object — an invalid key,
     * a throttle, a bad id all arrive looking like success. Treating that as data is how a
     * credentials problem becomes "no results" for a week, so it is raised here instead.
     */
    const err = json?.error as { code?: number; message?: string } | undefined;
    if (err) {
      /**
       * Back off on the throttling codes, which is the whole reason they are named above. The
       * daily cap gets the LONGEST cooldown we allow rather than the default minute: it resets on
       * their clock, not ours, so a short retry is just a wasted call — but a fixed long one still
       * recovers by itself once the day rolls over.
       */
      if (err.code === ERR_APP_LIMIT) applyCooldown('daily request limit reached', undefined, MAX_COOLDOWN_MS);
      else if (err.code === ERR_USER_THROTTLE) applyCooldown('throttled (too many actions)', undefined);
      throw new FatSecretHttpError(err.code ?? 400, err.message ?? 'FatSecret returned an error');
    }
    return json;
  } finally {
    releaseSlot();
  }
}

/** One API call, with single-flight coalescing on identical parameter sets. */
export async function fatSecretCall(params: Record<string, string>): Promise<unknown> {
  const cacheKey = JSON.stringify(Object.entries(params).sort());
  const existing = singleFlight.get(cacheKey);
  if (existing) return existing;
  const promise = rawCall(params).finally(() => singleFlight.delete(cacheKey));
  singleFlight.set(cacheKey, promise);
  return promise;
}
