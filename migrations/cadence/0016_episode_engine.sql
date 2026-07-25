-- 0016 — disrupted-mode episode engine (Req 4 Phase C). Makes the (already-modeled) episodes table
-- usable and adds the overlay primitives. Purely additive except the FK repoint in (a).

-- (a) Fix episodes.user_id FK. 0001 pointed it at auth.users, but auth was decoupled in 0002 and
--     every post-0002 table (goal_events, …) references cadence.users. Left as-is, an episode insert
--     for the dev user (which lives only in cadence.users) would FK-fail. Repoint it.
alter table cadence.episodes drop constraint if exists episodes_user_id_fkey;
alter table cadence.episodes
  add constraint episodes_user_id_fkey foreign key (user_id) references cadence.users (id) on delete cascade;

-- (b) `paused` occurrence status: a base occurrence shelved for an episode's duration (base plan
--     preserved, never a slip). System-set only; the client status endpoint keeps accepting only
--     pending|done|skipped, so no expand-then-contract dance is needed on the write side.
alter table cadence.occurrences drop constraint if exists occurrences_status_check;
alter table cadence.occurrences
  add constraint occurrences_status_check check (status in ('pending', 'done', 'skipped', 'missed', 'paused'));

-- (c) episode_id on occurrences: tags the TEMP "do what you can" occurrences an episode adds, so
--     ending it can drop the episode's future temp rows cleanly. Nullable; null for every base row.
alter table cadence.occurrences
  add column if not exists episode_id uuid references cadence.episodes (episode_id) on delete cascade;

-- (d) check_ins: the explicit "I'm here" signal. In a disrupted stretch a check-in counts as
--     showing up — it keeps the streak alive (and can extend it) even with nothing completed
--     (Req 4 "adapt, don't punish"). One row per user per day.
create table if not exists cadence.check_ins (
  user_id    uuid not null references cadence.users (id) on delete cascade,
  date       date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table cadence.check_ins enable row level security;
do $$ begin
  create policy check_ins_owner on cadence.check_ins
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
