-- 0007 — Weekly adaptive-replan trigger (Phase 3 remainder):
--   cadence.users gains last_assessed_at (weekly gate for situation_assess) and
--   pending_proposal (a coach-proposed action awaiting the user's accept/dismiss —
--   suggest-never-auto-apply, per BRAND.md's autonomy stance). Purely additive.
alter table cadence.users
  add column if not exists last_assessed_at timestamptz,
  add column if not exists pending_proposal jsonb;
