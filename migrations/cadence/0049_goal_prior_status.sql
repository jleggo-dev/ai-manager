-- 0049 — a parked goal remembers what it was.
-- Additive and idempotent; safe to re-run. NOT applied by this change — see PR notes.
--
-- Settings Room SR-1: retiring a goal sets status = 'parked' (BRAND.md: "parked" is the schema
-- word, "retire" is the UI word). Restoring it — "tell Cadence and she'll bring it back" — has to
-- put it back where it left off: a goal retired while still 'confirmed' (never made it into a
-- plan) is not the same as one retired while 'committed' (was actively shaping the week), and
-- nothing else on the row says which. Without this, restore could only ever guess 'confirmed'.
--
-- Nullable, and null is the ordinary resting state: any goal that isn't currently parked, plus a
-- goal parked before this column existed (its restore falls back to 'confirmed' in code — see
-- repos/goals.ts retireGoal/restoreGoal). Never abandoned/completed: those are done, not parked,
-- and stay out of the value set on purpose so a stale prior_status can't reopen a finished goal.
alter table cadence.goals
  add column if not exists prior_status text;

alter table cadence.goals drop constraint if exists goals_prior_status_check;
alter table cadence.goals add constraint goals_prior_status_check
  check (prior_status is null or prior_status in ('captured', 'confirmed', 'committed'));

comment on column cadence.goals.prior_status is
  'status this goal held immediately before being parked; null when not parked (or parked before this column existed). Set by retireGoal, consumed and cleared by restoreGoal.';
