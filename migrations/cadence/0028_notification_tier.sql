-- 0028 — the notification volume dial.
-- Additive and idempotent; safe to re-run.
--
-- 0026 gave notification_prefs a master switch, a quiet window, per-kind opt-outs and a blunt
-- daily cap. What it could not give — because no notification content existed yet — was an answer
-- to the only question a user actually has: *how much will this thing talk to me?*
--
-- `tier` is that answer, and it is deliberately ONE column rather than nine booleans in `kinds`.
-- Nine toggles is a configuration screen, and a configuration screen produces combinations nobody
-- designed and nobody can support ("why did I get this one but not that one?"). Three named
-- amounts — few / moderate / lots — are a promise a person can hold in their head, and they are
-- CUMULATIVE, so turning the dial up can never take something away.
--
-- `kinds` is not replaced and not deprecated. The two answer different questions: the tier is how
-- MUCH, per-kind mutes are "not that one, specifically". The tier is the setting; `kinds` remains
-- the escape hatch.
--
-- `max_per_day` also stays. The app now derives the day's cap from the tier (2 at lots, 1
-- otherwise) and takes the LOWER of the two, so this column keeps working as the belt-and-braces
-- guard 0026 described — a scheduler bug cannot spam past it even if the tier logic is wrong.

alter table cadence.notification_prefs
  add column if not exists tier text not null default 'moderate';

-- The check is added separately and guarded, because `add column if not exists` will not add a
-- constraint to a column that already exists — a half-applied 0028 would otherwise leave the
-- column unconstrained forever, which is exactly the state where a typo'd tier reaches the app
-- and every kind silently falls outside it.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'cadence.notification_prefs'::regclass
       and conname  = 'notification_prefs_tier_check'
  ) then
    alter table cadence.notification_prefs
      add constraint notification_prefs_tier_check check (tier in ('few', 'moderate', 'lots'));
  end if;
end $$;

comment on column cadence.notification_prefs.tier is
  'How much the coach may say: few | moderate | lots. Cumulative — each tier includes the ones '
  'below it. Default moderate. The catalog of kinds per tier lives in '
  'packages/cadence-shared/src/notifications/kinds.ts, NOT in the database: adding a nudge must '
  'not need a migration, and the tier a nudge belongs to is a product decision, not a schema one.';

-- Deliberately NOT backfilled to anything other than the default. Every existing row predates any
-- notification content whatsoever (nothing has ever been sent), so 'moderate' is not a guess about
-- what someone chose — it is the same starting point a new user gets.
--
-- Also deliberately NOT wired to the 0022 pack_touch watermark, matching 0026: a notification
-- preference is not context the coach reasons over.
