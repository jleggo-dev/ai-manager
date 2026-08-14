/**
 * Build the compact Apple Health digest the onboarding offer sends (confirm-first).
 * Pure aggregation over the capability seam's Workout shape — the digest is the parsed
 * abstraction (workouts by type/week), never raw samples. Server bounds mirror
 * apps/cadence-api/src/validation/health.ts: ≤25 types, ≤10 recent.
 */
import type { HealthDigest } from '@cadence/shared';
import type { DailySteps, Workout } from '../../lib/capability/index.ts';
import { isRecordedDistance } from '../../lib/capability/workout-distance.ts';
import { humanizeWorkoutType } from '../settings/health-import.ts';
import { summarizeDailySteps } from './steps-summary.ts';
import { clamp, MAX_KM, MAX_MINUTES, MAX_TYPE_CHARS, round1, summarizeWorkoutTypes } from './workout-summary.ts';

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

/**
 * The chat-open tier: much tighter, so when the coach checks their file THIS conversation,
 * this morning's workout is already on it. Separate throttle key — the app-launch check must
 * not eat the chat-open one (both throttles are ours; HealthKit reads are local and unmetered,
 * the throttle only spares our own API round-trips).
 */
export const CHAT_REFRESH_STALE_MS = 2 * 60 * 60 * 1000;
export const CHAT_REFRESH_MIN_INTERVAL_MS = 15 * 60 * 1000;
export const CHAT_REFRESH_CHECK_KEY = 'cadence.healthRefreshChatAt';

/** Pure staleness rule (exported for tests): refresh when there's no digest or it's too old. */
export function digestIsStale(createdAtISO: string | null, nowMs: number, staleMs: number = REFRESH_STALE_MS): boolean {
  if (!createdAtISO) return true;
  const t = Date.parse(createdAtISO);
  return !Number.isFinite(t) || nowMs - t > staleMs;
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
 * server-side digest current without asking again. Two tiers share this function: app-launch
 * (6h throttle, <24h counts as fresh) and chat-open (15min/2h via the CHAT_* overrides, so the
 * coach's file tools see today). Skipped when nothing changed — an identical POST would only
 * churn the pack_touch watermark and force needless context-pack rebuilds.
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
  /** Tier overrides (chat-open uses the tight set); defaults are the app-launch tier. */
  staleMs?: number;
  minIntervalMs?: number;
  throttleKey?: string;
}): Promise<'skipped' | 'fresh' | 'unchanged' | 'posted'> {
  const now = deps.now ?? Date.now;
  const staleMs = deps.staleMs ?? REFRESH_STALE_MS;
  const minIntervalMs = deps.minIntervalMs ?? REFRESH_MIN_INTERVAL_MS;
  const throttleKey = deps.throttleKey ?? REFRESH_CHECK_KEY;
  if (!deps.isAvailable() || window.localStorage.getItem(HEALTH_OFFER_FLAG_KEY) !== 'done') return 'skipped';
  const lastCheck = Number(window.localStorage.getItem(throttleKey) ?? 0);
  if (now() - lastCheck < minIntervalMs) return 'skipped';
  window.localStorage.setItem(throttleKey, String(now()));
  const latest = await deps.getLatest();
  if (!digestIsStale(latest.created_at, now(), staleMs)) return 'fresh';
  const since = new Date(now() - DIGEST_PERIOD_DAYS * 86_400_000).toISOString();
  // Steps must never be able to cost us the workouts. They are the newer, more fragile read (a
  // permission existing users were never asked for), so they degrade to [] on their own.
  const [workouts, steps] = await Promise.all([
    deps.getWorkouts(since),
    deps.getDailySteps?.(since).catch(() => []) ?? Promise.resolve([]),
  ]);
  // Same clock the `since` window was cut from, so the recency figures cannot straddle two.
  const digest = buildDigestFromWorkouts(workouts, DIGEST_PERIOD_DAYS, steps, now());
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
/**
 * How many individual sessions travel with the digest. They are the cheapest signal we have —
 * already collected, already bounded, already validated — and for a long time exactly one of them
 * was ever rendered. "Your last five runs were 5.2, 5.8, 4.9, 6.1 and 5.4 km, all in the past nine
 * days" is a different conversation from "you average 4.3 km", and it needs no arithmetic at all.
 * The server schema allows 10; raising this is a one-line change when we want it.
 */
const MAX_RECENT = 5;

export function buildDigestFromWorkouts(
  workouts: Workout[],
  periodDays = DIGEST_PERIOD_DAYS,
  steps: DailySteps[] = [],
  /** Injected for tests; the recency window is measured back from here. */
  nowMs: number = Date.now(),
): HealthDigest {
  const weeks = Math.max(1, periodDays / 7);
  const typeSummaries = summarizeWorkoutTypes(workouts, nowMs);

  const recent = [...workouts]
    .sort((a, b) => b.start.localeCompare(a.start))
    .slice(0, MAX_RECENT)
    .map((w) => ({
      type: humanizeWorkoutType(w.type).slice(0, MAX_TYPE_CHARS),
      start: w.start,
      durationMin: clamp(w.durationMin ?? null, MAX_MINUTES),
      // Same rule as the seam applies: a 0 here is "HealthKit had no distance for this session",
      // and a Workout can reach us from any capability implementation, not only the native one.
      distanceKm: isRecordedDistance(w.distanceKm) ? clamp(w.distanceKm, MAX_KM) : null,
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
