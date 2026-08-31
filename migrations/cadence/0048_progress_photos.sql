-- 0048 — progress photos (owner design "Cadence Progress" 1a, "PHOTOS · every 4 weeks ·
-- optional"): an every-4-weeks visual record the user OPTS INTO. Dates and weights only — a photo
-- row is never scored, compared, or judged; the tab shows the earliest and latest side by side and
-- says when the next one is due. `photo_ref` is a path in the private `progress-photos` storage
-- bucket (userId-scoped, same discipline as meal photos — purge is one folder walk); `weight_kg`
-- is the user's own nearest weigh-in within ±3 days of `taken_on` when one exists, else null —
-- absent is absent, never an invented number.
--
-- The opt-in flag lives on cadence.users (the coach_face_id idiom: one nullable column, additive).
-- NULL means never asked = off; everything photo-shaped — routes, availability, the card — returns
-- nothing until the user turns it on.
--
-- Purely additive. House style from 0044/0045: `if not exists` guards, no down-migration.
create table if not exists cadence.progress_photos (
  id         uuid primary key default gen_random_uuid(),
  -- FK to cadence.users, NOT auth.users — auth was decoupled in 0002.
  user_id    uuid not null references cadence.users (id) on delete cascade,
  taken_on   date not null,
  photo_ref  text not null,
  weight_kg  numeric,
  created_at timestamptz not null default now()
);

-- Serves the earliest/latest pair, the "all photos" list, and next-due (max taken_on) alike.
create index if not exists progress_photos_user_idx on cadence.progress_photos (user_id, taken_on);

alter table cadence.progress_photos enable row level security;
do $$ begin
  create policy progress_photos_owner on cadence.progress_photos
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

alter table cadence.users
  add column if not exists progress_photos_enabled boolean;

comment on column cadence.users.progress_photos_enabled is
  'Opt-in for the every-4-weeks progress photos (design "Cadence Progress" 1a). NULL = never asked = off. Photos are dated and weight-stamped, never scored.';
