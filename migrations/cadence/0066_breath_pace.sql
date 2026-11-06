-- 0066 — breath pace (owner, 2026-11-06): "I actually breathe slower than the device is going
-- today - some people may breathe faster."
--
-- The coach prescribes the pattern and the rounds; how long a count lasts belongs to the person's
-- lungs. Seconds per count: one number for every pattern, so a pattern's proportions survive and
-- "in for four" stays true at any pace. It lives on the account so it follows the person to a new
-- phone; brand promise, they never set it twice.
--
-- NULL = never set, which plays at a second a count. No check constraint on purpose: the range is
-- a product decision that belongs to `MIN_BREATH_PACE`/`MAX_BREATH_PACE` in @cadence/shared, the
-- route validates against those on write, and `clampBreathPace` bounds what is played on read
-- (including the per-pattern safety caps a column could not express).
--
-- Purely additive. House style from 0044/0045/0048/0050: `if not exists` guard, no down-migration.
-- Deploy order is forgiving only one way: apply this BEFORE the API ships, because the new route
-- reads the column and would 500 without it (the card then simply plays the phone's cached pace).
alter table cadence.users
  add column if not exists breath_pace double precision;

comment on column cadence.users.breath_pace is
  'Seconds per breath count, set by the person on the pacer. NULL = never set (1 second a count). Range and per-pattern safety caps are enforced in @cadence/shared (breath-pace.ts), not here.';
