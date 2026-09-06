import { sql } from '../db/sql.ts';
import type { WeatherSnapshot } from '../services/weather/weather-map.ts';

/**
 * Shared weather cache (migration 0025) — the L2 behind the process-local Map, so a cold start
 * or a second instance reuses a snapshot instead of re-billing the provider. Keyed by place+date,
 * never by user (see the migration's header for why). Every function soft-fails: the cache is an
 * optimisation, and a cache outage must degrade to a provider call, never to an error.
 *
 * Generic over the row's shape since the forecast series (`forecast-ahead.ts`) joined the
 * snapshot in here: the column is jsonb, the keys are namespaced (`forecast:` vs. the bare
 * place+date), and the point of a shared cache — one bill per populated cell — holds for both.
 */

export async function getCachedWeather<T = WeatherSnapshot>(cacheKey: string): Promise<T | null> {
  try {
    const rows = await sql<{ snapshot: T }[]>`
      select snapshot from cadence.weather_cache
      where cache_key = ${cacheKey} and expires_at > now()`;
    return rows[0]?.snapshot ?? null;
  } catch (e) {
    console.warn('[weather-cache] read failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function putCachedWeather<T = WeatherSnapshot>(
  cacheKey: string,
  snapshot: T,
  ttlMs: number,
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await sql`
      insert into cadence.weather_cache (cache_key, snapshot, fetched_at, expires_at)
      values (${cacheKey}, ${sql.json(JSON.parse(JSON.stringify(snapshot)))}, now(), ${expiresAt})
      on conflict (cache_key) do update
        set snapshot = excluded.snapshot, fetched_at = now(), expires_at = excluded.expires_at`;
  } catch (e) {
    console.warn('[weather-cache] write failed:', e instanceof Error ? e.message : e);
  }
}

/**
 * Drop long-dead rows. Keys embed the local date, so expired rows are never read again — this
 * only stops unbounded growth. Called opportunistically from the miss path (which is already
 * doing an HTTP round trip, so one indexed delete is noise).
 */
export async function pruneExpiredWeather(): Promise<void> {
  try {
    await sql`delete from cadence.weather_cache where expires_at < now() - interval '1 day'`;
  } catch (e) {
    console.warn('[weather-cache] prune failed:', e instanceof Error ? e.message : e);
  }
}
