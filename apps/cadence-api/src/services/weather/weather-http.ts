/**
 * Rate-limited OpenWeatherMap HTTP client.
 * Process-local: single-flight + concurrency cap + 429 cooldown (anti-stampede).
 * Key is server-only (cadenceConfig.weatherApiKey) — never logged.
 */
import { cadenceConfig } from '../../config.ts';

const OWM_BASE = 'https://api.openweathermap.org/data/2.5';
const OWM_GEO_BASE = 'https://api.openweathermap.org/geo/1.0';
const MAX_IN_FLIGHT = 2;
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 5 * 60_000;

export class WeatherConfigError extends Error {
  constructor(message = 'OpenWeatherMap is not configured') {
    super(message);
    this.name = 'WeatherConfigError';
  }
}

export class WeatherHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'WeatherHttpError';
    this.status = status;
  }
}

export function isWeatherConfigured(): boolean {
  return Boolean(cadenceConfig.weatherApiKey?.trim());
}

function requireApiKey(): string {
  const key = cadenceConfig.weatherApiKey?.trim();
  if (!key) throw new WeatherConfigError();
  return key;
}

type FetchFn = typeof fetch;

let fetchImpl: FetchFn = globalThis.fetch.bind(globalThis);
let inFlight = 0;
let cooldownUntil = 0;
const waiters: Array<() => void> = [];
const singleFlight = new Map<string, Promise<unknown>>();

/** Test seam — inject a mock fetch; resets rate-limit state. */
export function __setWeatherFetchForTests(fn: FetchFn | null): void {
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

function applyCooldown(res: Response): void {
  const retryAfter = res.headers.get('retry-after');
  let ms = DEFAULT_COOLDOWN_MS;
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs > 0) ms = Math.min(MAX_COOLDOWN_MS, secs * 1000);
  }
  cooldownUntil = Math.max(cooldownUntil, Date.now() + ms);
  console.warn(`[weather] rate limited (429); cooling down ${ms}ms`);
}

async function rawOwmGet(base: string, pathAndQuery: string): Promise<unknown> {
  const key = requireApiKey();
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  // appid last; never log the full URL (contains the key).
  const url = `${base}${pathAndQuery}${sep}appid=${encodeURIComponent(key)}`;

  await acquireSlot();
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (res.status === 429) {
      applyCooldown(res);
      throw new WeatherHttpError(429, 'OpenWeatherMap rate limit exceeded — try again shortly');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const pathOnly = pathAndQuery.split('?')[0] ?? pathAndQuery;
      console.warn(`[weather] HTTP ${res.status} for ${pathOnly}: ${body.slice(0, 200)}`);
      throw new WeatherHttpError(res.status, `OpenWeatherMap request failed (${res.status})`);
    }
    return (await res.json()) as unknown;
  } finally {
    releaseSlot();
  }
}

/**
 * GET with single-flight coalescing: concurrent identical paths share one HTTP call.
 * Path must NOT include appid.
 */
export async function owmGet(pathAndQuery: string): Promise<unknown> {
  const existing = singleFlight.get(pathAndQuery);
  if (existing) return existing;

  const promise = rawOwmGet(OWM_BASE, pathAndQuery).finally(() => {
    singleFlight.delete(pathAndQuery);
  });
  singleFlight.set(pathAndQuery, promise);
  return promise;
}

/** Geocoding API (city → lat/lon). Path must NOT include appid. */
export async function owmGeoGet(pathAndQuery: string): Promise<unknown> {
  const flightKey = `geo:${pathAndQuery}`;
  const existing = singleFlight.get(flightKey);
  if (existing) return existing;

  const promise = rawOwmGet(OWM_GEO_BASE, pathAndQuery).finally(() => {
    singleFlight.delete(flightKey);
  });
  singleFlight.set(flightKey, promise);
  return promise;
}
