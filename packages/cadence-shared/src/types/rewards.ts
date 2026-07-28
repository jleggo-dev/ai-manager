/* ════════════════════════════════════════════════════════════════
   Rewards — the habit-first points wallet (REQ8)
   ════════════════════════════════════════════════════════════════ */

/**
 * The persisted points wallet (one per user, `users.points_state`, migration 0020). Points reward
 * *building better habits* (brand) — completed tasks, a completed day, weekly active minutes, and
 * streak length — and are redeemable for streak freezes. Same single-jsonb, forward-only pattern as
 * [[StreakState]] (types/streak.ts): computed in services/points.ts, `last_evaluated` (YYYY-MM-DD)
 * makes the daily fold idempotent. `balance` is spendable; `lifetime` only ever grows.
 */
export interface PointsState {
  balance: number;
  lifetime: number;
  last_evaluated: string | null;
}

/**
 * The client-facing wallet, surfaced on the plan response beside `StreakView`. `freeze_cost` +
 * `can_redeem_freeze` let the UI show "N to your next freeze" and enable the redeem action only
 * when it would actually succeed (enough points AND below the freeze cap).
 */
export interface PointsView {
  balance: number;
  lifetime: number;
  freeze_cost: number;
  can_redeem_freeze: boolean;
}
