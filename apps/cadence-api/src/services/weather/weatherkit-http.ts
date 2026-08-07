/**
 * Apple WeatherKit REST client — ES256 provider JWT from a .p8 key, no SDK dependency.
 *
 * Deliberately a sibling of `services/push-apns.ts` rather than a shared helper: the signing is
 * four lines, but the CLAIMS differ (WeatherKit needs `sub` = Services ID and `id` =
 * `TEAM.SERVICE` in the header; APNs has neither), and folding two Apple products into one
 * "signer" abstraction would hide exactly the field most likely to be wrong.
 *
 * One request per miss: WeatherKit returns currentWeather + forecastHourly together, so this
 * halves OWM's two calls (current + forecast) per cache miss.
 */
import { createSign, createPrivateKey } from 'node:crypto';
import { cadenceConfig } from '../../config.ts';

const WEATHERKIT_BASE = 'https://weatherkit.apple.com/api/v1';

/** Apple allows up to an hour; refresh at 45 min, matching the APNs sender. */
const JWT_TTL_MS = 45 * 60 * 1000;
let cachedJwt: { value: string; mintedAt: number } | null = null;

/** Cooldown after a 429 so a rate-limited key doesn't get hammered by every call site. */
const COOLDOWN_MS = 5 * 60_000;
let cooldownUntil = 0;

export class WeatherKitError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'WeatherKitError';
    this.status = status;
  }
}

/** Defensive read: an absent block means "WeatherKit off", never a crash in the weather path. */
function wkConfig() {
  return cadenceConfig.weatherkit ?? { keyId: '', teamId: '', serviceId: '', privateKey: '' };
}

export function isWeatherKitConfigured(): boolean {
  const { keyId, teamId, serviceId, privateKey } = wkConfig();
  return Boolean(keyId && teamId && serviceId && privateKey);
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/**
 * Mint (or reuse) the provider token. Exported for tests — the claim set is the single most
 * error-prone part of this integration and a 401 from Apple says nothing about which field is wrong.
 */
export function weatherKitJwt(nowMs = Date.now()): string {
  const age = cachedJwt ? nowMs - cachedJwt.mintedAt : -1;
  if (cachedJwt && age >= 0 && age < JWT_TTL_MS) return cachedJwt.value;

  const { keyId, teamId, serviceId, privateKey } = wkConfig();
  const iat = Math.floor(nowMs / 1000);
  // `id` (header) and `sub` (claims) are the two fields APNs does not have. `id` must be
  // TEAMID.SERVICEID — not the bundle ID, and not the key ID.
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, id: `${teamId}.${serviceId}`, typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat, exp: iat + 60 * 60, sub: serviceId }));
  const signer = createSign('SHA256');
  signer.update(`${header}.${claims}`);
  // .p8 keys arrive via env with literal \n; ieee-p1363 is the JWT (r||s) signature form.
  const key = createPrivateKey(privateKey.replace(/\\n/g, '\n'));
  const sig = signer.sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  cachedJwt = { value: `${header}.${claims}.${sig}`, mintedAt: nowMs };
  return cachedJwt.value;
}

type FetchFn = typeof fetch;
let fetchImpl: FetchFn = globalThis.fetch.bind(globalThis);

/** Test seam — inject a mock fetch and reset the JWT/cooldown state. */
export function __setWeatherKitFetchForTests(fn: FetchFn | null): void {
  fetchImpl = fn ?? globalThis.fetch.bind(globalThis);
  cachedJwt = null;
  cooldownUntil = 0;
}

/**
 * Current + next hours for one coordinate, in one request.
 *
 * `timezone` is required by the API for daily boundaries; we pass the user's IANA zone when we
 * have one. A 404 means Apple has no data for that point (mid-ocean, some territories) — a real
 * answer, not a failure, so it is reported as an error the caller falls back from rather than
 * retried.
 */
export async function weatherKitGet(lat: number, lon: number, timezone?: string | null): Promise<unknown> {
  if (!isWeatherKitConfigured()) throw new WeatherKitError(0, 'WeatherKit is not configured');
  if (Date.now() < cooldownUntil) throw new WeatherKitError(429, 'WeatherKit cooling down after a rate limit');

  const tz = timezone?.trim() || 'UTC';
  const url =
    `${WEATHERKIT_BASE}/weather/en/${encodeURIComponent(String(lat))}/${encodeURIComponent(String(lon))}` +
    `?dataSets=currentWeather,forecastHourly&timezone=${encodeURIComponent(tz)}`;

  const res = await fetchImpl(url, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${weatherKitJwt()}` },
  });

  if (res.status === 429) {
    cooldownUntil = Date.now() + COOLDOWN_MS;
    throw new WeatherKitError(429, 'WeatherKit rate limit exceeded');
  }
  if (res.status === 401 || res.status === 403) {
    // Almost always a claim/capability mismatch rather than a transient fault, and it will repeat
    // on every request — say which fields to check rather than logging an opaque status.
    console.warn(
      `[weatherkit] HTTP ${res.status} — check WEATHERKIT_SERVICE_ID (Services ID, not bundle ID), ` +
        'WEATHERKIT_TEAM_ID, and that the key has the WeatherKit capability enabled.',
    );
    throw new WeatherKitError(res.status, 'WeatherKit rejected the provider token');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`[weatherkit] HTTP ${res.status}: ${body.slice(0, 200)}`);
    throw new WeatherKitError(res.status, `WeatherKit request failed (${res.status})`);
  }
  return (await res.json()) as unknown;
}
