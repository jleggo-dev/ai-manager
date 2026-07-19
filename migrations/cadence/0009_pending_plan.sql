-- 0009 — Plan-preview-before-commit: cadence.users gains pending_plan (a synthesized + vetted
-- but NOT YET committed activity schedule, awaiting the user's confirm/dismiss — same
-- suggest-never-auto-apply pattern as pending_proposal, applied to the FIRST plan lock).
-- Purely additive.
alter table cadence.users
  add column if not exists pending_plan jsonb;
