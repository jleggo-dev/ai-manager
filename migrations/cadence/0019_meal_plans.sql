-- 0019 — Req 5 Phase 5: meal plans + shopping list polish.
-- Table already exists (0001); FK → cadence.users (0002). Additive + idempotent.

alter table cadence.meal_plans
  add column if not exists notes text null;

alter table cadence.meal_plans
  add column if not exists updated_at timestamptz not null default now();

-- One committed plan per user per week (confirm replaces via upsert).
create unique index if not exists meal_plans_user_week_uidx
  on cadence.meal_plans (user_id, week_of);

create index if not exists meal_plans_user_week_idx
  on cadence.meal_plans (user_id, week_of desc);
