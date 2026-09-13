-- 0059 — how far ahead the week was DELIBERATELY built (owner, 2026-09-09).
--
-- The trail shows seven days from today, and a week materializes once at its commit — so from
-- the second day of a week the view runs past what was written. Those days are behind the
-- check-in: locked until the weekly check-in, because the check-in can redefine the following
-- week. The user can choose to build next week early ("Build next week" on the wall card, a tap on
-- a locked day, or the coach's build_week_ahead), which writes it on the same rhythm WITHOUT moving
-- the check-in. `built_through` is the date that choice reached; the lock stands past the later
-- of the check-in date and this one.
--
-- Why a column and not "does the day have rows": an ordinary mid-week commit (an Adjust on a
-- Thursday) also materializes seven days from today, which reaches past Sunday's check-in as a
-- side effect. Those rows are not a decision to build next week, and the days must stay locked.
-- Only the deliberate build sets this; `commitActivities` carries it forward on an ordinary
-- commit and clears it when a commit starts a new week; "Confirm my week" clears it too.
--
-- Purely additive, house style (0044/0050/0058): `if not exists`, no down-migration, no backfill
-- — null means "nothing built past the check-in", which is true of every existing plan.
alter table cadence.plans
  add column if not exists built_through date;
