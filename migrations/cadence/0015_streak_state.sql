-- 0015 — streak_state: the reinstated, PROTECTED streak + freeze economy (Req 4).
-- BRAND.md retired streaks (v1.0); the founder reversed that 2026-07-24 ("build better habits"),
-- but only as a streak that CANNOT punish you for life happening — a freeze economy + check-ins +
-- disrupted-mode `paused` days keep it from resetting to zero, and the honest 5-of-7 rolling
-- metric always coexists. State is a single per-user jsonb blob (same pattern as macro_targets /
-- steer_back), computed forward-only in services/streak.ts. Purely additive.
-- Default seeds one freeze so a new user's first streak has a cushion (SEED_FREEZES in metrics.ts).
alter table cadence.users
  add column if not exists streak_state jsonb not null default
    '{"current":0,"longest":0,"freezes":1,"freeze_credit":0,"last_evaluated":null,"last_saved_by_freeze":null}';
