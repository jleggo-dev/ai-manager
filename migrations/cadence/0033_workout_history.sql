-- 0033 — workout_history: individual recorded workouts, as ROWS (the dataset behind the digest).
--
-- The digest (0024) is the summary; this is the log. Three doors share the table, named by
-- `source`: 'healthkit' (device-pushed — HealthKit is reachable only on-device), 'strava'
-- (server-side import, later), 'cadence' (bridged from occurrences.log, later). Dedup is the
-- unique (user_id, source, source_id): HealthKit's per-workout UUID, Strava's activity id, the
-- occurrence id. `raw` keeps door-specific extras schemalessly — notably HealthKit's recording
-- app, which is how a Strava-double-synced run will be recognized when both doors are open.
-- Rows are the user's own health record; RLS mirrors health_digests.

create table if not exists cadence.workout_history (
  workout_id   uuid primary key default gen_random_uuid(),
  user_id      uuid not null references cadence.users (id) on delete cascade,
  source       text not null check (source in ('healthkit', 'strava', 'cadence')),
  source_id    text not null,
  type         text not null,
  started_at   timestamptz not null,
  duration_min numeric,
  distance_km  numeric,
  avg_hr       numeric,
  raw          jsonb,
  created_at   timestamptz not null default now(),
  unique (user_id, source, source_id)
);

create index if not exists workout_history_user_recent
  on cadence.workout_history (user_id, started_at desc);

alter table cadence.workout_history enable row level security;
do $$ begin
  create policy workout_history_owner on cadence.workout_history
    using (user_id = auth.uid())
    with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- Pack invalidation (0022 rule): new recorded activity must not sit behind a stale pack.
-- Per-row like everywhere else; `on conflict do nothing` rows never fire it, so the steady
-- state is 0–2 fires per refresh and only the one-time first import pays a burst.
drop trigger if exists pack_touch on cadence.workout_history;
create trigger pack_touch after insert or update or delete on cadence.workout_history
  for each row execute function cadence.touch_pack();
