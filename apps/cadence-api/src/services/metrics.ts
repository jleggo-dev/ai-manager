import type { Occurrence, StreakDay, StreakParams, StreakState, StreakView } from '@cadence/shared';

/**
 * Deterministic metrics computed from the store (spec §B3) — the numbers the
 * report jobs (recap, surface_insights) and situation_assess consume. The app
 * computes these; the LLM only narrates them (it never tallies).
 */

/** Slim shape `rollingConsistency` needs — listOccurrences omits session/log. */
export type ConsistencyOccurrence = Pick<Occurrence, 'date' | 'status'>;

/**
 * The scheduled-days-only denominator, shared: how many of `days` (YYYY-MM-DD strings) had
 * ANYTHING scheduled at all (`scheduled`), and how many of those were done (`kept`). A date
 * absent from `occurrences` entirely is a genuine gap — nothing was ever due — and leaves both
 * counters alone rather than silently counting as a miss (check-in rebuild, step 6; BRAND.md's
 * no-streak-shame rule). Pure. `rollingConsistency` (trailing N days from today) and the Progress
 * Engine's rhythm resolver (Monday-start week buckets) both fold their day list through this ONE
 * function — extracted so the denominator math is never forked between the two callers.
 */
export function keptScheduledForDays(
  occurrences: ConsistencyOccurrence[],
  days: string[],
): { kept: number; scheduled: number } {
  // Normalize each occurrence date to a YYYY-MM-DD string — the DB driver returns `date` columns
  // as JS Date objects, which would never match the ISO strings we probe the set with.
  const doneDays = new Set(
    occurrences.filter((o) => o.status === 'done').map((o) => new Date(o.date).toISOString().slice(0, 10)),
  );
  // ANY occurrence on a date — regardless of status — means something was actually due that day.
  // A date with no entry here never had anything scheduled at all.
  const scheduledDays = new Set(occurrences.map((o) => new Date(o.date).toISOString().slice(0, 10)));
  let kept = 0;
  let scheduled = 0;
  for (const key of days) {
    if (scheduledDays.has(key)) {
      scheduled++;
      if (doneDays.has(key)) kept++;
    }
  }
  return { kept, scheduled };
}

/**
 * Rolling-window consistency: how many of the last `windowDays` days had ≥1 completed
 * occurrence, as kept/window (e.g. "5 of 7"). Replaces streaks per BRAND.md — a missed day
 * lowers the ratio, it NEVER resets progress to zero ("hearth, not scoreboard"). Pure.
 *
 * **The denominator excludes days with NOTHING scheduled at all** (check-in rebuild, step 6) —
 * a day with zero occurrences leaves both `kept` and `window` alone, rather than silently
 * counting as a miss. This matters for two real cases, not just a future one: once the horizon
 * stops rolling (`DEFAULT_HORIZON_DAYS`), days past it are genuine gaps — nothing was ever
 * materialized there, not "materialized and missed" — and a brand-new user with no plan yet has
 * NO occurrences in the window at all, which now reads as 0 of 0, never the streak-shame "0 of 7"
 * BRAND.md forbids (DESIGN-check-in.md's own open question). A day that HAD something scheduled
 * but wasn't completed (pending/skipped/missed) still counts against the denominator exactly as
 * before — only a true absence of any row for that date is new.
 */
export function rollingConsistency(
  occurrences: ConsistencyOccurrence[],
  today = new Date(),
  windowDays = 7,
): { kept: number; window: number } {
  const days: string[] = [];
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  for (let i = 0; i < windowDays; i++) {
    days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  const { kept, scheduled } = keptScheduledForDays(occurrences, days);
  return { kept, window: scheduled };
}

/* ────────────────────────────────────────────────────────────────
   Streak + freeze economy (Req 4). The streak is a PROTECTED momentum
   counter atop rollingConsistency — see PLAN.md "Req 4" + BRAND.md
   (amended 2026-07-24). Pure + forward-only, like progression.ts.
   ──────────────────────────────────────────────────────────────── */

/** Earn 1 freeze per 7 consecutive kept days; hold at most 2. */
export const DEFAULT_STREAK_PARAMS: StreakParams = { earnEvery: 7, freezeCap: 2 };
/** A brand-new streak starts with one freeze so an early stumble isn't brutal. */
export const SEED_FREEZES = 1;

export type DayClass = 'kept' | 'neutral' | 'slip';

/**
 * kept  = they showed up (a done occurrence or an explicit check-in).
 * slip  = something was genuinely due, they didn't show, and no episode was shielding the day.
 * neutral = everything else — a rest day (nothing due), an acknowledged skip, or a no-show
 *           inside a disrupted episode. Neutral days neither extend nor break the run.
 */
export function classifyDay(day: StreakDay): DayClass {
  if (day.engaged) return 'kept';
  if (day.due && !day.inEpisode) return 'slip';
  return 'neutral';
}

export function initialStreakState(): StreakState {
  return {
    current: 0,
    longest: 0,
    freezes: SEED_FREEZES,
    freeze_credit: 0,
    last_evaluated: null,
    last_saved_by_freeze: null,
  };
}

/**
 * Walk a run of FINALIZED (past) days — ascending, each strictly after `prior.last_evaluated` —
 * and fold them into the streak state. Pure. A slip spends a freeze if one is banked (the streak
 * holds); with none left it resets `current` to 0 (never negative, never below zero). Because the
 * caller only ever passes days after `last_evaluated`, re-running is a no-op on an unchanged tail
 * (idempotent) and a past freeze decision is never re-derived.
 */
export function advanceStreak(
  prior: StreakState,
  days: StreakDay[],
  params: StreakParams = DEFAULT_STREAK_PARAMS,
): StreakState {
  const s: StreakState = { ...prior };
  for (const day of days) {
    const dayClass = classifyDay(day);
    switch (dayClass) {
      case 'kept': {
        s.current += 1;
        s.freeze_credit += 1;
        if (s.freeze_credit >= params.earnEvery) {
          s.freeze_credit -= params.earnEvery;
          if (s.freezes < params.freezeCap) s.freezes += 1; // over-cap earnings are forfeited
        }
        if (s.current > s.longest) s.longest = s.current;
        break;
      }
      case 'slip': {
        if (s.freezes > 0) {
          s.freezes -= 1;
          s.last_saved_by_freeze = day.date; // streak held — never reset for a covered slip
        } else {
          s.current = 0;
          s.freeze_credit = 0;
        }
        break;
      }
      case 'neutral':
        // Rest day / acknowledged skip / episode-shielded no-show — run continues untouched
        break;
      default: {
        const _exhaustive: never = dayClass;
        void _exhaustive;
      }
    }
    s.last_evaluated = day.date;
  }
  return s;
}

/** Whole-day difference between two YYYY-MM-DD strings (b - a), UTC. */
function daysBetweenIso(a: string, b: string): number {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0]!, pb[1]! - 1, pb[2]!) - Date.UTC(pa[0]!, pa[1]! - 1, pa[2]!)) / 86_400_000);
}

/**
 * Project the finalized state onto TODAY for display. Today is provisional: a kept today extends
 * the shown count by one; a due-but-not-yet-done today is NOT a slip yet (grace until day end), so
 * the count simply holds. `savedByFreeze` lights up when a freeze rescued the streak in the last
 * ~2 days, so the coach can reassure ("a freeze saved your streak") instead of the user seeing a
 * silent hold.
 */
export function computeStreakView(state: StreakState, today: StreakDay): StreakView {
  const shown = state.current + (classifyDay(today) === 'kept' ? 1 : 0);
  const savedByFreeze =
    state.last_saved_by_freeze != null && daysBetweenIso(state.last_saved_by_freeze, today.date) <= 2;
  return {
    current: shown,
    longest: Math.max(state.longest, shown),
    freezes: state.freezes,
    savedByFreeze,
  };
}
