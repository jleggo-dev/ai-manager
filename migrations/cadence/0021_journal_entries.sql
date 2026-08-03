-- 0021 — journal_entries: the Mind pillar's first module-class store (REQ9 §4.5, journal-brief).
--
-- The store is the product: entries are the user's words, kept verbatim and reread — never
-- analysed in UI (rule 1: words in, words back). `secret` is the per-entry key (Design's word for
-- private): a secret entry is excluded from context packs AND from Scribe parsing entirely
-- (REQ9 §8 — nothing scans it), retroactively. `mode` records the door the words came through:
-- typed, spoken (STT transcript; audio discarded after save), or paper — a shelf row for an entry
-- written in a physical journal (no body, auto-secret by nature).
--
-- `prompt` keeps the question the entry grew from (the question is half the meaning when
-- rereading); `bank` is its stable id so gratitude entries can carry the share-out affordance.
-- `source_occurrence_id` marks entries written by a session's journal step (nothing else about an
-- entry reveals its door).

create table if not exists cadence.journal_entries (
  entry_id    uuid primary key default gen_random_uuid(),
  user_id     uuid not null references cadence.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  bank        text null,
  prompt      text null,
  body        text not null default '',
  secret      boolean not null default false,
  mode        text not null default 'typed' check (mode in ('typed', 'spoken', 'paper')),
  source_occurrence_id uuid null references cadence.occurrences (occurrence_id) on delete set null
);

create index if not exists journal_entries_user_recent
  on cadence.journal_entries (user_id, created_at desc);

alter table cadence.journal_entries enable row level security;
do $$ begin
  create policy journal_entries_owner on cadence.journal_entries
    using (user_id = auth.uid())
    with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
