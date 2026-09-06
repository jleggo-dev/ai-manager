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
    /** `/me/progress-layout/draft` (Wave 3, W3-2) — the coach's proposed layout, awaiting the
     *  card's "Set my page this way"/"Not now". A separate key from `all` on purpose: committing
     *  invalidates `all` (the page repaints), never `draft` itself — the draft is gone by then. */
    draft: ['progressLayout', 'draft'] as const,
  },
  /** `/me/weather` (PERF-03) — the trail header's one line of sky. */
  weather: {
    all: ['weather'] as const,
  },
  /**
   * `/me/location` — where they live, where they ARE, and the timezone (A21's two points).
   *
   * Through the cache since 2026-09-05, and the reason is the boot paint rather than the request
   * count: nothing about the place was ever kept on the device, so every cold launch started not
   * knowing whether there was one — and the header read that silence as "never set". Persisted
   * like everything else now (boot-policy.ts), so the place is on screen before the network.
   */
  location: {
    all: ['location'] as const,
  },
  /** `/me/health-digest` (W1-6) — stored HealthKit summaries; the steps `weekly_bars` widget. */
  healthDigest: {
    all: ['healthDigest'] as const,
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
  /** The non-temporal Progress Engine reads (routes/progress-extras.ts, W1-5) — one key per
   *  endpoint × its params, since (unlike `progress`/`plan`) each of these is scoped to a
   *  window and sometimes a goal, not a single shared view. */
  progressExtras: {
    events: (from: string, to: string) => ['progressExtras', 'events', from, to] as const,
    balance: (kind: string, window: string) => ['progressExtras', 'balance', kind, window] as const,
    totals: (goalId: string, window: string) => ['progressExtras', 'totals', goalId, window] as const,
    variety: (window: string, meal?: string) => ['progressExtras', 'variety', window, meal ?? 'dinner'] as const,
    stagePath: (goalId: string) => ['progressExtras', 'stagePath', goalId] as const,
    count: (goalId: string) => ['progressExtras', 'count', goalId] as const,
    /** '' = unscoped (everything they keep); a goal id scopes to that goal's items. */
    repertoire: (goalId: string) => ['progressExtras', 'repertoire', goalId] as const,
    /** Always the trailing four weeks — no window/goal variants to key on. */
    feltWeeks: ['progressExtras', 'feltWeeks'] as const,
    /** Start-to-now pairs — no window/goal variants to key on either. */
    thenNow: ['progressExtras', 'thenNow'] as const,
  },
  /** `/progress/photo-pair` + `/progress/photos` (routes/progress-photos.ts) — the opt-in photo
   *  pair (the card) and the full list (SR-5's "All photos" screen). An upload or an enable/
   *  disable invalidates both: either can change what the card AND the screen would show. */
  progressPhotos: {
    pair: ['progressPhotos', 'pair'] as const,
    all: ['progressPhotos', 'all'] as const,
    /** Just the opt-in state + count + next-due, without the signed URLs of every photo — what a
     *  settings toggle and the quick-add row need in order to render themselves. */
    status: ['progressPhotos', 'status'] as const,
  },
  /** `/me/recaps` (the `recap_rail` widget, Progress Engine W2-1) — weekly check-in recaps,
   *  persisted at confirm time. Scoped by `limit` so the rail's own default doesn't collide with a
   *  caller asking for more. */
  recaps: {
    scoped: (limit: number) => ['recaps', limit] as const,
  },
  /** `/me/units` — the resolved display units. One key, because Settings writes them and the
   *  trail, the rows, the quiet-hours chip and the proposed week all read the clock from it. */
  units: {
    all: ['units'] as const,
  },
  /** `/review` — goals, tools and the baseline. One key: the Settings root counts them, the goals
   *  and tools doors edit them, and the weigh-in row reads the baseline out of the same answer, so
   *  none of the four can be showing a different account of what is on the plan. */
  review: {
    all: ['review'] as const,
  },
  /** `/me/constraints` — what the plan is being built around. Its own key rather than a slice of
   *  `review`: a different endpoint, and coach-owned, so it is invalidated on its own terms. */
  constraints: {
    all: ['constraints'] as const,
  },
  /** `/me/routines` — the activities they've built. Settings' "Your activities" door lists and
   *  edits them; quick-add shelves the same rows per area. */
  routines: {
    all: ['routines'] as const,
  },
  /** `/nutrition/recipes` — the cookbook. Scoped by `savedOnly` because the shelves ask for the
   *  saved ones and the Food room's count asks for all of them; two questions, two answers. */
  recipes: {
    scoped: (savedOnly: boolean) => ['recipes', savedOnly ? 'saved' : 'all'] as const,
  },
  /** `/nutrition/meal-plans?week_of=` — the cooking week. Keyed by the week so scrolling to
   *  another one caches on its own terms; `'current'` is whatever `getCurrentMealPlan` defaults to. */
  mealPlan: {
    week: (weekOf?: string) => ['mealPlan', weekOf ?? 'current'] as const,
  },
  /** `/nutrition/recent?days=N` — the meals behind the Food room's day dots and week strip. */
  recentMeals: {
    days: (days: number) => ['recentMeals', days] as const,
  },
  /** `/nutrition/dietary-profile` — allergies and things to skip. Read by Settings, the kitchen
   *  intake and the coach's food sheet, which must never disagree about an allergen. */
  dietaryProfile: {
    all: ['dietaryProfile'] as const,
  },
  /** `/progress/repertoire/items` — the whole list room (items, collisions, collections), scoped
   *  by the goal it is filtered to; `''` is everything they keep. */
  repertoireList: {
    scoped: (goalId: string | null) => ['repertoireList', goalId ?? ''] as const,
  },
  /** `/plan/earlier?weeks=N` — the week(s) before today, loaded when the trail is scrolled back
   *  to log something missed. Under the `plan` prefix so a log invalidates it with the week. */
  planEarlier: {
    weeks: (n: number) => ['plan', 'earlier', n] as const,
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
