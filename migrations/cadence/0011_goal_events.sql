-- 0011 — goal_events: countable, dated accomplishments ("finished Dune", "hit 100 pull-ups").
-- Powers count-type goal progress (books 20/100) and the History feed. Written by the
-- parse-session-log path (explicit completions in the user's own words) and manual adds.
-- goal_id is nullable + set-null on goal delete: deleting a goal never erases history.
-- Purely additive.
create table if not exists cadence.goal_events (
  event_id   uuid primary key default gen_random_uuid(),
  -- FK to cadence.users, NOT auth.users — auth was decoupled in 0002 (dev accounts + lazy
  -- provisioning both rely on cadence.users being the standalone identity table).
  user_id    uuid not null references cadence.users (id) on delete cascade,
  goal_id    uuid references cadence.goals (goal_id) on delete set null,
  kind       text not null default 'completion' check (kind in ('completion', 'note')),
  label      text not null,
  at         timestamptz not null default now(),
  meta       jsonb,
  created_at timestamptz not null default now()
);
create index if not exists goal_events_user_at_idx on cadence.goal_events (user_id, at desc);

alter table cadence.goal_events enable row level security;
do $$ begin
  create policy goal_events_owner on cadence.goal_events
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
