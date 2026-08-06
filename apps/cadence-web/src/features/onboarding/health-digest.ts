/**
 * Build the compact Apple Health digest the onboarding offer sends (confirm-first).
 * Pure aggregation over the capability seam's Workout shape — the digest is the parsed
 * abstraction (workouts by type/week), never raw samples. Server bounds mirror
 * apps/cadence-api/src/validation/health.ts: ≤25 types, ≤10 recent.
 */
import type { HealthDigest, HealthDigestTypeSummary } from '@cadence/shared';
import type { Workout } from '../../lib/capability/index.ts';
import { humanizeWorkoutType } from '../settings/health-import.ts';

export const DIGEST_PERIOD_DAYS = 90;
export const HEALTH_OFFER_FLAG_KEY = 'cadence.healthOffer'; // 'done' | 'dismissed'

/** True once the user has answered the onboarding offer either way. */
export function healthOfferAnswered(): boolean {
  const v = window.localStorage.getItem(HEALTH_OFFER_FLAG_KEY);
  return v === 'done' || v === 'dismissed';
}

/** Refresh cadence: skip when the stored digest is younger than this. */
export const REFRESH_STALE_MS = 24 * 60 * 60 * 1000;
const REFRESH_CHECK_KEY = 'cadence.healthRefreshAt';
/** Local throttle so an app that's opened many times a day doesn't re-check the server each time. */
export const REFRESH_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Pure staleness rule (exported for tests): refresh when there's no digest or it's >24h old. */
export function digestIsStale(createdAtISO: string | null, nowMs: number): boolean {
  if (!createdAtISO) return true;
  const t = Date.parse(createdAtISO);
  return !Number.isFinite(t) || nowMs - t > REFRESH_STALE_MS;
}

/** Key-order-insensitive equality — jsonb round-trips reorder object keys. */
export function digestsEqual(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
    if (v && typeof v === 'object')
      return `{${Object.entries(v as Record<string, unknown>)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, val]) => `${JSON.stringify(k)}:${canon(val)}`)
        .join(',')}}`;
    return JSON.stringify(v) ?? 'null';
  };
  return canon(a) === canon(b);
}

/**
 * Silent foreground refresh: once permission was granted (offer answered 'done'), keep the
 * server-side digest current without asking again. Throttled locally (6h), skipped while the
 * stored digest is fresh (<24h), and skipped when nothing changed — an identical POST would
 * only churn the pack_touch watermark and force needless context-pack rebuilds.
 */
export async function maybeRefreshHealthDigest(deps: {
  isAvailable: () => boolean;
  getWorkouts: (sinceISO: string) => Promise<Workout[]>;
  getLatest: () => Promise<{ digest: HealthDigest | null; created_at: string | null }>;
  post: (digest: HealthDigest) => Promise<boolean>;
  now?: () => number;
}): Promise<'skipped' | 'fresh' | 'unchanged' | 'posted'> {
  const now = deps.now ?? Date.now;
  if (!deps.isAvailable() || window.localStorage.getItem(HEALTH_OFFER_FLAG_KEY) !== 'done') return 'skipped';
  const lastCheck = Number(window.localStorage.getItem(REFRESH_CHECK_KEY) ?? 0);
  if (now() - lastCheck < REFRESH_MIN_INTERVAL_MS) return 'skipped';
  window.localStorage.setItem(REFRESH_CHECK_KEY, String(now()));
  const latest = await deps.getLatest();
  if (!digestIsStale(latest.created_at, now())) return 'fresh';
  const since = new Date(now() - DIGEST_PERIOD_DAYS * 86_400_000).toISOString();
  const digest = buildDigestFromWorkouts(await deps.getWorkouts(since));
  if (latest.digest && digestsEqual(digest, latest.digest)) return 'unchanged';
  await deps.post(digest);
  return 'posted';
}

/**
 * Goal-gated offer (detour pattern): the coach offers in prose when the goal warrants it —
 * the persona always names "Apple Health" when offering — and the card renders under that
 * turn. Returns the index of the LAST offering coach turn (a re-offer moves the card), or -1.
 */
export function findHealthOfferTurn(turns: { role: string; text: string }[]): number {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t && t.role === 'coach' && /apple\s+health/i.test(t.text)) return i;
  }
  return -1;
}
const MAX_TYPES = 25;
const MAX_RECENT = 5;

const round1 = (n: number) => Math.round(n * 10) / 10;

function avg(nums: number[]): number | null {
  return nums.length ? round1(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
}

export function buildDigestFromWorkouts(workouts: Workout[], periodDays = DIGEST_PERIOD_DAYS): HealthDigest {
  const byType = new Map<string, Workout[]>();
  for (const w of workouts) {
    const t = humanizeWorkoutType(w.type);
    byType.set(t, [...(byType.get(t) ?? []), w]);
  }
  const weeks = Math.max(1, periodDays / 7);
  const typeSummaries: HealthDigestTypeSummary[] = [...byType.entries()]
    .map(([type, list]) => ({
      type,
      count: list.length,
      avgDurationMin: avg(list.map((w) => w.durationMin).filter((n): n is number => n != null)),
      avgDistanceKm: avg(list.map((w) => w.distanceKm).filter((n): n is number => n != null)),
      lastISO:
        list
          .map((w) => w.start)
          .sort()
          .at(-1) ?? '',
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_TYPES);

  const recent = [...workouts]
    .sort((a, b) => b.start.localeCompare(a.start))
    .slice(0, MAX_RECENT)
    .map((w) => ({
      type: humanizeWorkoutType(w.type),
      start: w.start,
      durationMin: w.durationMin ?? null,
      distanceKm: w.distanceKm ?? null,
    }));

  return {
    periodDays,
    totalWorkouts: workouts.length,
    weeklyFrequency: round1(workouts.length / weeks),
    byType: typeSummaries,
    recent,
  };
}
