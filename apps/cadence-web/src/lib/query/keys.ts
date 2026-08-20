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
  /** The `/progress` dashboard (PERF-01) — one key, refetched on the ＋1 event path. */
  progress: {
    all: ['progress'] as const,
  },
} as const;

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
