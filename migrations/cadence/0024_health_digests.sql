-- 0024 — health_digests: client-built Apple Health activity summaries (onboarding health context).
--
-- HealthKit is reachable only on-device, so the digest is built client-side and POSTed after an
-- explicit in-chat confirmation (confirm-first, like every import surface). The row is the parsed
-- ABSTRACTION — workouts by type/week — never raw samples; the retrieval registry renders it into
-- coach/broker context via get_health_history. `source` records the door the data came through
-- (healthkit today; a future Health-Connect path would name itself), NOT the original recording
-- app — by the time data reaches HealthKit it is the user's own health record.

create table if not exists cadence.health_digests (
  digest_id   uuid primary key default gen_random_uuid(),
  user_id     uuid not null references cadence.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  period_days int not null,
  source      text not null default 'healthkit',
  digest      jsonb not null
);

create index if not exists health_digests_user_recent
  on cadence.health_digests (user_id, created_at desc);

alter table cadence.health_digests enable row level security;
do $$ begin
  create policy health_digests_owner on cadence.health_digests
    using (user_id = auth.uid())
    with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- Pack invalidation (0022 rule): a fresh digest must not sit behind a reused stale pack.
drop trigger if exists pack_touch on cadence.health_digests;
create trigger pack_touch after insert or update or delete on cadence.health_digests
  for each row execute function cadence.touch_pack();
