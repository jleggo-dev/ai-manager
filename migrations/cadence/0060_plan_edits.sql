-- 0060 — plan_edits: the by-hand changes to the calendar, so the coach knows about them.
--
-- Owner, 2026-09-15: "Part of the rule for moving things in the calendar was that Cadence would
-- know about it (moving, deleting, adding)." The trail's hold menu (2026-09-07) moves a dated
-- session to another day, copies it onto one, or takes it off — and nothing recorded that anywhere
-- the coach reads. A moved row is just a row on a different day; a deleted one is gone. This is
-- the record: one row per edit, whoever made it — the person from the trail (`source = 'trail'`),
-- or the coach herself through edit_calendar (`source = 'coach'`). The plan read she carries on
-- every turn renders the last week of `trail` edits (retrieval/calendar-function.ts).
--
-- A log, not a flag on the occurrence: a delete leaves no occurrence to flag, and the fact worth
-- knowing is the change, not the row's current state (the calendar read shows that already).
--
-- FK to cadence.users, not auth.users — auth was decoupled in 0002 (goal_events, 0011, is the
-- shape this follows). Purely additive, house style: `if not exists`, no down-migration, no
-- backfill — an edit made before this table existed is simply not on record.
create table if not exists cadence.plan_edits (
  edit_id    uuid primary key default gen_random_uuid(),
  user_id    uuid not null references cadence.users (id) on delete cascade,
  source     text not null check (source in ('trail', 'coach')),
  action     text not null check (action in ('move', 'copy', 'delete')),
  title      text not null,
  from_date  date not null,
  to_date    date,
  at         timestamptz not null default now()
);
create index if not exists plan_edits_user_at_idx on cadence.plan_edits (user_id, at desc);

alter table cadence.plan_edits enable row level security;
do $$ begin
  create policy plan_edits_owner on cadence.plan_edits
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
