/* ════════════════════════════════════════════════════════════════
   Streak + freeze economy (Req 4) — the reinstated, PROTECTED streak
   ════════════════════════════════════════════════════════════════ */

/**
 * The persisted streak state (one per user, `users.streak_state`). A streak is a momentum
 * counter that sits ATOP the honest `rollingConsistency` metric — never a replacement for it.
 * It is protected by construction (see `advanceStreak`): a **freeze** absorbs an ordinary slip,
 * and disrupted-mode / check-in days never even count as slips, so the count never resets to zero
 * *because life happened* (BRAND.md, amended 2026-07-24). `last_evaluated` makes the whole thing
 * forward-only + idempotent: a past day's freeze decision is finalized once and never re-derived.
 */
export interface StreakState {
  /** Consecutive kept days through `last_evaluated` (NOT including today — today is provisional). */
  current: number;
  longest: number;
  /** Banked freezes, 0..freezeCap. */
  freezes: number;
  /** Progress toward the next earned freeze (0..earnEvery-1). */
  freeze_credit: number;
  /** YYYY-MM-DD of the last finalized (past) day; null for a user who's never been evaluated. */
  last_evaluated: string | null;
  /** The date a freeze last rescued the streak — powers a gentle "a freeze saved your streak" note. */
  last_saved_by_freeze: string | null;
}

/**
 * One day's inputs to the pure streak walk. The app builds these from the store; the classifier
 * (`classifyDay`) turns them into kept / neutral / slip.
 * - `due`     — ≥1 occurrence that day with a real obligation (pending/done/missed). An
 *               acknowledged `skipped` occurrence does NOT create due-pressure.
 * - `engaged` — the user showed up: ≥1 `done` occurrence that day, OR an explicit check-in.
 * - `inEpisode` — a disrupted episode covered this day (base work is paused → shields a no-show
 *               from becoming a slip). Wired in Phase C; false until then.
 */
export interface StreakDay {
  date: string; // YYYY-MM-DD
  due: boolean;
  engaged: boolean;
  inEpisode: boolean;
}

/**
 * The client-facing streak, INCLUDING today provisionally (a kept today extends the shown count;
 * a due-but-not-yet-done today is not a slip yet, so the count just holds). Rendered beside the
 * "5 of 7" consistency chip, never instead of it.
 */
export interface StreakView {
  current: number;
  longest: number;
  freezes: number;
  /** A freeze rescued the streak within the last ~2 days — surface the reassurance, gently. */
  savedByFreeze: boolean;
}

/** Freeze economy knobs (see PLAN.md "Req 4"). Earn 1 freeze per `earnEvery` consecutive kept
 *  days, capped at `freezeCap`. */
export interface StreakParams {
  earnEvery: number;
  freezeCap: number;
}
