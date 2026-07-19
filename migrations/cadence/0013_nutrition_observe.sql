-- 0013: nutrition observation instrument (the Observe phase of the module arc).
-- nutrition_logs exists since 0001 (FK already repointed to cadence.users by 0002). Additive:
--   raw_text — the user's own words, always kept (brand promise: nothing you say is lost);
--   flags    — sparse deterministic-ish signals parse-meal may set ONLY from explicit mentions
--              (e.g. {"alcohol":true,"caffeine":true});
--   meal     — widen to 'drink' and 'other' so a beer or an odd nibble isn't shoehorned.
alter table cadence.nutrition_logs add column if not exists raw_text text;
alter table cadence.nutrition_logs add column if not exists flags jsonb not null default '{}';
alter table cadence.nutrition_logs drop constraint if exists nutrition_logs_meal_check;
alter table cadence.nutrition_logs
  add constraint nutrition_logs_meal_check
  check (meal in ('breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other'));
