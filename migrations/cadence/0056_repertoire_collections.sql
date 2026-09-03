-- 0056 — a collection becomes a row of its own, and items point at it.
-- Idempotent, safe to re-run. NOT applied by this change — the orchestrator applies it.
--
-- Owner ruling 2026-09-03: "a collection only works if it's not free-text." Until now a collection
-- was a NAME copied onto every item (meta->>'collection'). Three things were impossible with that:
-- renaming a collection in one place, having a collection with no items in it yet, and telling two
-- spellings of one name apart from two real groups. A row with an id fixes all three — the name
-- lives in one place, the items carry a foreign key, and the unique index makes the name the
-- identity rather than the spelling.
--
-- Nothing here is music-specific. A collection is a book, a syllabus, a reading list, a set of
-- poems, a grading ladder. There is deliberately no `kind` column (a domain word is not a fact the
-- app needs) and no `ordered` flag (order already lives on the item as meta->>'rank').
--
-- Deleting a collection never deletes an item: the item's collection_id goes null (`on delete set
-- null`) and the item stays on the person's list, ungrouped.

create table if not exists cadence.repertoire_collections (
  collection_id uuid primary key default gen_random_uuid(),
  user_id       uuid not null references cadence.users(id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 120),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Names are unique per person, ignoring case — the same rule item labels already follow
-- (repertoire_user_label_uidx, on lower(label)). This index IS the "not free-text" guarantee:
-- "Suzuki Book 2" and "suzuki book 2" cannot both exist for one person.
create unique index if not exists repertoire_collections_user_name_idx
  on cadence.repertoire_collections (user_id, lower(name));

alter table cadence.repertoire
  add column if not exists collection_id uuid references cadence.repertoire_collections(collection_id) on delete set null;

create index if not exists repertoire_collection_idx on cadence.repertoire (collection_id);

-- House style for every user-scoped table since 0045 (repertoire itself, user_routines, …).
alter table cadence.repertoire_collections enable row level security;
do $$ begin
  create policy repertoire_collections_owner on cadence.repertoire_collections
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- Dossier-relevant, the same reasoning 0045 gave for cadence.repertoire: the coach's shelf render
-- prints each item's collection NAME, so renaming a collection changes what she reads and a pack
-- built before the rename is stale.
drop trigger if exists pack_touch on cadence.repertoire_collections;
create trigger pack_touch after insert or update or delete on cadence.repertoire_collections
  for each row execute function cadence.touch_pack();

-- Backfill, in two idempotent statements.
--
-- 1. One collection per (user, lower(name)) out of the names items carry today. `distinct on`
--    picks the FIRST-SEEN spelling (oldest row wins, ties broken by item_id so the result does not
--    depend on scan order), which is the same "first spelling wins" rule the old in-memory
--    collectionsOf() applied. `on conflict do nothing` makes a second run write nothing.
insert into cadence.repertoire_collections (user_id, name)
select distinct on (r.user_id, lower(btrim(r.meta->>'collection')))
       r.user_id, btrim(r.meta->>'collection')
from cadence.repertoire r
where r.meta->>'collection' is not null
  and length(btrim(r.meta->>'collection')) between 1 and 120
order by r.user_id, lower(btrim(r.meta->>'collection')), r.started_at, r.item_id
on conflict do nothing;

-- 2. Point every item at the collection its name now names. Only rows that have no collection_id
--    yet are touched, so a second run — or a row grouped by hand since — is left alone.
update cadence.repertoire r
set collection_id = c.collection_id,
    updated_at = now()
from cadence.repertoire_collections c
where r.collection_id is null
  and r.meta->>'collection' is not null
  and c.user_id = r.user_id
  and lower(c.name) = lower(btrim(r.meta->>'collection'));

-- The meta key `collection` is deliberately LEFT in place, the same way `catalogue` was left when
-- that field went: after this migration no code reads or writes it, so it costs nothing and loses
-- nothing, and a row whose backfill needs re-checking still carries the name it came in with.

comment on table cadence.repertoire_collections is
  'a named group of repertoire items — a book, a syllabus, a reading list. Name is unique per user ignoring case; deleting one sets its items'' collection_id to null and never deletes an item.';

comment on column cadence.repertoire.collection_id is
  'the collection this item belongs to, or null when it is not grouped. Replaces meta->>''collection'' (0056), which is no longer read.';
