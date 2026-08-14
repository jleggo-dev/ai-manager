-- 0032: a baseline write invalidates the context pack — the coach re-asked for a weight the
-- Broker had captured fifteen minutes earlier, because 0022's watermark triggers cover the child
-- tables but not cadence.users, where the baseline (weight, height, age, availability), name,
-- dietary profile and macro targets all live. Additive + idempotent.
--
-- Its own trigger function, twice over: 0022's touch_pack() reads new.user_id, a column the users
-- table does not have (its id is `id`); and the watermark column lives ON this very row, so a
-- BEFORE trigger stamps it in-flight — no second UPDATE, no recursion to reason about.
--
-- Conditional on the dossier-real columns, in the same spirit as the occurrences trigger: users
-- rows are touched constantly (streak_state daily, pending_plan during builds), and an
-- unconditional trigger would kill pack reuse entirely.
create or replace function cadence.touch_pack_self() returns trigger
language plpgsql as $$
begin
  new.pack_touched_at := now();
  return new;
end $$;

drop trigger if exists pack_touch on cadence.users;
create trigger pack_touch
  before update on cadence.users
  for each row
  when (
    old.baseline is distinct from new.baseline
    or old.name is distinct from new.name
    or old.macro_targets is distinct from new.macro_targets
    or old.dietary_profile is distinct from new.dietary_profile
    or old.home_location is distinct from new.home_location
    or old.timezone is distinct from new.timezone
  )
  execute function cadence.touch_pack_self();
