/**
 * Build the compact Apple Health digest the onboarding offer sends (confirm-first).
 * Pure aggregation over the capability seam's Workout shape — the digest is the parsed
 * abstraction (workouts by type/week), never raw samples. Server bounds mirror
 * apps/cadence-api/src/validation/health.ts: ≤25 types, ≤10 recent.
 */
import type { HealthDigest, HealthDigestTypeSummary } from '@cadence/shared';
import type { DailySteps, Workout } from '../../lib/capability/index.ts';
import { humanizeWorkoutType } from '../settings/health-import.ts';
import { summarizeDailySteps } from './steps-summary.ts';

export const DIGEST_PERIOD_DAYS = 90;
export const HEALTH_OFFER_FLAG_KEY = 'cadence.healthOffer'; // 'done' | 'dismissed'

/** True once the user has answered the onboarding offer either way. */
/**
 * Have we already SHARED their activity? 'done' means the digest is stored, so re-offering would
 * be asking for something we have. Deliberately narrower than `healthOfferAnswered`: a dismissal
 * is "not now", and treating it as "never" left someone who later ASKED for Apple Health with a
 * coach agreeing to pull it and no card to confirm with.
 */
export function healthAlreadyShared(): boolean {
  return window.localStorage.getItem(HEALTH_OFFER_FLAG_KEY) === 'done';
}

/** Have we offered at all — used only to stop the coach offering again unprompted. */
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
  /** Optional so a caller that only has workouts still compiles; a failure here degrades to
   *  workouts-only rather than losing the refresh. */
  getDailySteps?: (sinceISO: string) => Promise<DailySteps[]>;
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
  // Steps must never be able to cost us the workouts. They are the newer, more fragile read (a
  // permission existing users were never asked for), so they degrade to [] on their own.
  const [workouts, steps] = await Promise.all([
    deps.getWorkouts(since),
    deps.getDailySteps?.(since).catch(() => []) ?? Promise.resolve([]),
  ]);
  const digest = buildDigestFromWorkouts(workouts, DIGEST_PERIOD_DAYS, steps);
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

/**
 * The digest's own API schema bounds every number, and it validates the payload as a WHOLE — so a
 * single implausible workout (a tracker left running for two days, a distance in the wrong unit)
 * used to reject the entire digest and surface as "I couldn't read Apple Health just now". One bad
 * row should cost its own accuracy, never the other months of history.
 * Mirrors apps/cadence-api/src/validation/health.ts.
 */
const MAX_MINUTES = 1_440;
const MAX_KM = 1_000;
const MAX_TYPE_CHARS = 80;

const clamp = (n: number | null, hi: number): number | null =>
  n == null || !Number.isFinite(n) ? null : Math.min(Math.max(n, 0), hi);

function avg(nums: number[]): number | null {
  return nums.length ? round1(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
}

export function buildDigestFromWorkouts(
  workouts: Workout[],
  periodDays = DIGEST_PERIOD_DAYS,
  steps: DailySteps[] = [],
): HealthDigest {
  const byType = new Map<string, Workout[]>();
  for (const w of workouts) {
    const t = humanizeWorkoutType(w.type);
    byType.set(t, [...(byType.get(t) ?? []), w]);
  }
  const weeks = Math.max(1, periodDays / 7);
  const typeSummaries: HealthDigestTypeSummary[] = [...byType.entries()]
    .map(([type, list]) => ({
      type: type.slice(0, MAX_TYPE_CHARS),
      count: list.length,
      avgDurationMin: clamp(avg(list.map((w) => w.durationMin).filter((n): n is number => n != null)), MAX_MINUTES),
      avgDistanceKm: clamp(avg(list.map((w) => w.distanceKm).filter((n): n is number => n != null)), MAX_KM),
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
      type: humanizeWorkoutType(w.type).slice(0, MAX_TYPE_CHARS),
      start: w.start,
      durationMin: clamp(w.durationMin ?? null, MAX_MINUTES),
      distanceKm: clamp(w.distanceKm ?? null, MAX_KM),
    }));

  // Omitted, never zeroed, when nothing was read — see summarizeDailySteps.
  const dailySteps = summarizeDailySteps(steps);

  return {
    periodDays,
    totalWorkouts: workouts.length,
    weeklyFrequency: round1(workouts.length / weeks),
    byType: typeSummaries,
    recent,
    ...(dailySteps ? { dailySteps } : {}),
  };
}
