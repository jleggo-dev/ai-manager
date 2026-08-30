/**
 * Shared TanStack Query keys for Cadence web (CROSS-03 pilot).
 * Keep keys hierarchical so `invalidateQueries({ queryKey: queryKeys.nutritionDay.all })`
 * refreshes every date variant after meal log / targets / weigh-in.
 */
export const queryKeys = {
  nutritionDay: {
    all: ['nutritionDay'] as const,
    /** ISO calendar date `YYYY-MM-DD` — always normalize before use so Today + Occurrence share cache. */
    day: (date: string) => ['nutritionDay', date] as const,
  },
  /** The whole `/plan` view (PERF-01) — gate routing, PlanView, and plan-reading sheets share it. */
  plan: {
    all: ['plan'] as const,
  },
  /** The `/progress` dashboard (PERF-01) — `all` is the unwindowed default (refetched on the
   *  ＋1 event path, unchanged); `window` adds the 'week' | 'month' | 'all' variant so each
   *  window paints from its own cache entry instead of fighting over one key. */
  progress: {
    all: ['progress'] as const,
    window: (w: 'week' | 'month' | 'all') => ['progress', w] as const,
  },
  /** `GET /progress/history?from&to` — the rhythm widget's raw inputs + assembled payload. */
  progressHistory: {
    range: (from: string, to: string) => ['progressHistory', from, to] as const,
  },
  /** `/me/progress-layout` (the Progress Engine's layout store, W1-4) — the committed layout, or
   *  the deterministic default when the user has none. Invalidate after a commit (Wave 3). */
  progressLayout: {
    all: ['progressLayout'] as const,
  },
  /** `/me/weather` (PERF-03) — the trail header's one line of sky. */
  weather: {
    all: ['weather'] as const,
  },
  /** `/me/sessions` (W1-3) — the `dated_sessions` widget + its drill-down list, keyed by the
   *  activity title + window so each combination caches independently. */
  datedSessions: {
    all: ['datedSessions'] as const,
    scoped: (activity: string, window: string) => ['datedSessions', activity, window] as const,
  },
  /** `/me/daily-checkin` (PERF-03) — is the one unprompted moment due today. */
  dailyCheckin: {
    all: ['dailyCheckin'] as const,
  },
} as const;

/**
 * Longer than the 30s client default, for the two Plan-tab reads whose answers genuinely do not
 * move on that timescale (PERF-03). Both used to fire on EVERY return to the tab — the burst the
 * 2026-08-20 latency report counted at ~6 requests per tab switch.
 *
 * Weather: five minutes. It is a forecast rounded to a condition word and a temperature; nothing
 * observable changes inside that window, and a real move re-fetches explicitly (the travel check
 * in useTodayHeader invalidates rather than waits).
 *
 * Daily check-in: five minutes. The gate is once per local DAY and lives server-side, so asking
 * again thirty seconds later cannot produce a different answer.
 */
export const AMBIENT_STALE_MS = 300_000;

/** Local calendar date as `YYYY-MM-DD` (nutrition day is calendar-local, not UTC). */
export function localTodayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Resolve an optional date arg to the canonical day key segment. */
export function nutritionDayKeyDate(date?: string, now = new Date()): string {
  return date ?? localTodayIso(now);
}
