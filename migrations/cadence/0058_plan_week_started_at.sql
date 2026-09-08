-- 0058 — the week clock (owner, 2026-09-07): "I still have never been prompted for a weekly
-- check-in." `computeWeekState` derived `ends_on`/`checkin_due` from the ACTIVE plan's
-- `generated_at`, and every commit — accepting a proposal, an Adjust, adding a routine, a replan,
-- the fan-out — inserts a new version with a fresh `generated_at`. An engaged user who touched
-- their plan at all had their week silently restarted, so the check-in never came due.
--
-- `week_started_at` is the clock that DOESN'T move on an ordinary commit: `commitActivities`
-- carries it forward from the superseded version, and only the two check-in exits — "Just build
-- my week" (`buildNextWeek`) and "Confirm my week" (the week-review confirm route) — reset it to
-- now(). A first-ever plan starts its week at its own commit. `computeWeekState`, `extendHorizon`,
-- the weekly_checkin push producer and the coach's "their week ended N days ago" line all read
-- `coalesce(week_started_at, generated_at)`, so screen, push and coach agree on the same day.
--
-- Purely additive. House style from 0044/0045/0048/0050: `if not exists` guards, no
-- down-migration. Backfill: every existing plan's week began when it was generated — exactly the
-- behaviour the app had until now, so nothing about a live user's week changes on apply.
alter table cadence.plans
  add column if not exists week_started_at timestamptz;

update cadence.plans
  set week_started_at = generated_at
  where week_started_at is null;
