-- 0049 — per-plan horizon (owner, 2026-08-31): the week's view span stays 7 days by default
-- (check-in rebuild step 6 — "the horizon IS the view window"), but the user can now ASK the
-- coach to run a week longer ("can we plan two weeks ahead?"), and the grant has to be a fact
-- the plan itself remembers: `computeWeekState` derives `ends_on`/`checkin_due` from it, and the
-- weekly_checkin push reads the same bound so screen and push can never disagree about which day
-- the week ran out.
--
-- Purely additive. House style from 0044/0045/0048: `if not exists` guards, no down-migration.
alter table cadence.plans
  add column if not exists horizon_days integer not null default 7;

do $$ begin
  alter table cadence.plans
    add constraint plans_horizon_days_range check (horizon_days between 1 and 28);
exception
  when duplicate_object then null;
end $$;
