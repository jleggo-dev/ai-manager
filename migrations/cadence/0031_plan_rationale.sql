-- 0031: the plan learns to explain itself (present-then-discuss, PLAN.md 2026-08-12).
--
-- `plans.rationale` — the coach's reasoning for the WHOLE shape (the arithmetic, the phases, why
-- the suggested activities earn their slots). Until now this text was returned in the HTTP
-- response and never stored, which was survivable only because nothing rendered it; the pre-signup
-- card does, and someone who bounces off the gate and comes back must not find a plan that has
-- forgotten why it looks the way it does. Nullable: plans committed before this migration have no
-- rationale, and that is the true state — backfilling prose we never generated would be invention.
--
-- `activities.suggested` — TRUE when the coach proposed this commitment herself (adjacent support:
-- research for a writer, mobility for a lifter) rather than the user asking for it. The card shows
-- the distinction at the consent moment; post-commit it is dossier data (so the coach can check in
-- on her own suggestions honestly), never a permanent badge.
alter table cadence.plans
  add column if not exists rationale text;

alter table cadence.activities
  add column if not exists suggested boolean not null default false;
