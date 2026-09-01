-- 0052 — user-built routines (Activity Builder wave 3): "the coach's toolbox, handed to you."
--
-- `cadence.user_routines` holds what the USER built — a name, an area, and a full `session` jsonb
-- (the exact same OccurrenceSession shape prescribe_session emits: blocks/items/note/generated_at/
-- version). One palette, one player: a user-built activity is not a second runtime, it is the same
-- data the coach writes, so it plays in the same walkthrough and logs the same honest way.
--
-- The COMPANION-ACTIVITY model (the load-bearing decision here) is why `activity_id` exists:
-- rather than teaching the plan/occurrence/consistency/streak machinery a second kind of "thing you
-- can do," a routine that gets run or scheduled mints (lazily, on first use — see
-- services/user-routines.ts) an ordinary row in `cadence.activities`, kind='user', category
-- 'user_built' (repos/activities.ts's USER_BUILT_CATEGORY — deliberately NOT in
-- NON_PLAN_CATEGORIES, because once scheduled a user routine IS a plan commitment and belongs in
-- Today/Week/consistency like any coach-built one). Runs and schedules ride the EXISTING
-- occurrence/horizon/consistency machinery unchanged; nothing here duplicates it. `activity_id`
-- points at that companion row so the routine can find it again — and gets re-pointed if a later
-- active plan supersedes the one it was minted on (the companion is re-minted on the new plan,
-- carrying the SAME activities.commitment_id forward, so its run history stays one continuous
-- lineage the way any other commitment's does — see repos/routines.ts's whole `commitment_id`
-- story from Activity Builder wave 1).
--
-- `provenance` records how the routine came to exist (blank / copied from a Cadence-built lineage /
-- saved from a Recap) — a UI-facing fact, never consulted by the running/scheduling machinery.
--
-- Purely additive, house style from 0048/0051: `if not exists` guards, no down-migration. FK to
-- cadence.users, NOT auth.users — auth was decoupled in 0002.
create table if not exists cadence.user_routines (
  routine_id  uuid primary key default gen_random_uuid(),
  user_id     uuid not null references cadence.users (id) on delete cascade,
  name        text not null,
  -- Nullable: a routine need not commit to one of the four goal areas up front (Fresh/blank
  -- starts, "Something else…" free-typed builds) — absent renders as Foundations, same as an
  -- activity with no goal link elsewhere.
  area        text,
  -- The full built session (blocks/items/note/generated_at/version) — validated + bounded on the
  -- way in by services/session-normalize.ts's normalizeSession, the SAME sanitizer prescribe-
  -- session's coach-emitted output goes through (One palette: nothing here is user-only shaped).
  session     jsonb not null,
  provenance  jsonb not null default '{"kind":"blank"}',
  -- The companion activities row, once minted (null until first run or first schedule — see the
  -- header comment above). `on delete set null` rather than cascade: an activities row is never
  -- hard-deleted by this feature (deleting a routine reverts its companion's recurrence to '' and
  -- leaves the row + its occurrence history in place), so this only guards against the row
  -- vanishing some other way.
  activity_id uuid references cadence.activities (activity_id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Serves "everything the user has built, newest first" (the list route's whole query).
create index if not exists user_routines_user_idx on cadence.user_routines (user_id, created_at desc);

alter table cadence.user_routines enable row level security;
do $$ begin
  create policy user_routines_owner on cadence.user_routines
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
