-- 0045 — repertoire: the material a person is learning or already knows, per skills practice.
-- Piano pieces, katas, poems, techniques. For skills-based progression the list of what someone
-- knows IS the progression record, and practice draws on known material — so it needs per-item
-- STATE (working/known/parked, last practiced), which the append-only goal_events ledger cannot
-- carry. Transitions still write goal_events (a piece learned is an accomplishment); this table
-- holds the current truth. Owner ruling 2026-08-30, from the 2026-08-29 piano conversation where
-- nine known pieces had to be typed into chat and landed as one frozen how_to sentence.
-- goal_id nullable + set-null, same reasoning as 0011: what they know outlives any one goal.
-- Purely additive.
create table if not exists cadence.repertoire (
  item_id           uuid primary key default gen_random_uuid(),
  -- FK to cadence.users, NOT auth.users — auth was decoupled in 0002.
  user_id           uuid not null references cadence.users (id) on delete cascade,
  goal_id           uuid references cadence.goals (goal_id) on delete set null,
  label             text not null,
  status            text not null default 'working' check (status in ('working', 'known', 'parked')),
  kind              text,
  meta              jsonb,
  started_at        timestamptz not null default now(),
  learned_at        timestamptz,
  last_practiced_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One row per thing they can name: re-mentioning "Écossaise" updates, never duplicates.
create unique index if not exists repertoire_user_label_uidx
  on cadence.repertoire (user_id, lower(label));
create index if not exists repertoire_user_status_idx
  on cadence.repertoire (user_id, status, last_practiced_at);

alter table cadence.repertoire enable row level security;
do $$ begin
  create policy repertoire_owner on cadence.repertoire
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- Dossier-relevant (get_repertoire renders it into context) → joins the pack-touch watermark
-- family from 0022, or context packs go stale on repertoire writes.
drop trigger if exists pack_touch on cadence.repertoire;
create trigger pack_touch after insert or update or delete on cadence.repertoire
  for each row execute function cadence.touch_pack();
