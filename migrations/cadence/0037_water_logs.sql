-- 0037 — water tracking (Food Journey act 1/2; owner greenlight 2026-08-19).
--
-- One row per pour, never a daily counter mutated in place: rows keep the when (a hot-afternoon
-- pattern is real coaching signal later), delete cleanly with the user, and sum deterministically.
-- Canonical unit is millilitres — schema words stay boring (BRAND nomenclature); glasses and
-- ounces are display arithmetic in the app, not storage.
create table if not exists cadence.water_logs (
  water_id   uuid primary key default gen_random_uuid(),
  user_id    uuid not null references cadence.users (id) on delete cascade,
  date       date not null,
  -- A pour, not a day: 5 L in one entry is a typo, not hydration.
  ml         integer not null check (ml > 0 and ml <= 5000),
  created_at timestamptz not null default now()
);

create index if not exists water_logs_user_date on cadence.water_logs (user_id, date);
