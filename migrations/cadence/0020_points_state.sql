-- 0020 — points_state: the habit-first rewards wallet (REQ8).
-- Points reward *building better habits* (brand), earned from completed tasks, a completed day,
-- weekly active minutes (effort, even if incomplete), and streak length; redeemable for streak
-- freezes. Same single per-user jsonb pattern as streak_state (0015) / macro_targets, computed
-- forward-only in services/points.ts (`advancePoints`). Purely additive.
-- `balance` is spendable; `lifetime` only grows; `last_evaluated` makes the daily fold idempotent.
alter table cadence.users
  add column if not exists points_state jsonb not null default
    '{"balance":0,"lifetime":0,"last_evaluated":null}';
