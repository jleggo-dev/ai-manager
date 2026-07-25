-- 0017 — Req 5 WS1: foods foundation (shared-aware, MFP-style servings) + dietary_profile
-- + nutrition_logs.recipe_id correlation + recipes.source 'ai_from_chat'.
--
-- FKs for nutrition_logs / recipes / meal_plans were already repointed to cadence.users
-- in 0002_decouple_auth.sql — verified on the shared project; no re-repoint here.
-- Additive + idempotent; safe to re-run.

-- (a) foods — shared-aware cache; owner NULL = global/shared (e.g. OpenFoodFacts later).
create table if not exists cadence.foods (
  food_id         uuid primary key default gen_random_uuid(),
  owner_user_id   uuid null references cadence.users (id) on delete cascade,
  visibility      text not null default 'private'
                    check (visibility in ('private', 'shared')),
  name            text not null,
  brand           text null,
  source          text not null
                    check (source in ('llm', 'label_photo', 'manual', 'chat', 'off')),
  off_id          text null,
  -- MFP serving model: macros stored PER BASE; named servings map to a base amount.
  -- g/ml → macros_per_base is per 100; item → per 1.
  base_unit       text not null check (base_unit in ('g', 'ml', 'item')),
  macros_per_base jsonb not null default '{}',
  servings        jsonb not null default '[]',
  default_serving int not null default 0,
  confidence      real null,
  photo_ref       text null,
  created_at      timestamptz not null default now(),
  constraint foods_private_needs_owner check (
    visibility <> 'private' or owner_user_id is not null
  )
);

create index if not exists foods_name_lower_idx on cadence.foods (lower(name));
create index if not exists foods_brand_idx on cadence.foods (brand);
create index if not exists foods_owner_idx on cadence.foods (owner_user_id);
create index if not exists foods_visibility_idx on cadence.foods (visibility)
  where visibility = 'shared';

alter table cadence.foods enable row level security;
do $$ begin
  create policy foods_select on cadence.foods for select
    using (owner_user_id = auth.uid() or visibility = 'shared');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy foods_write on cadence.foods for all
    using (owner_user_id = auth.uid())
    with check (owner_user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- (b) food_usage — per-user recents/frequents projection (shared foods stay ownerless).
create table if not exists cadence.food_usage (
  user_id      uuid not null references cadence.users (id) on delete cascade,
  food_id      uuid not null references cadence.foods (food_id) on delete cascade,
  use_count    int not null default 1,
  last_used_at timestamptz not null default now(),
  primary key (user_id, food_id)
);

create index if not exists food_usage_user_recent_idx
  on cadence.food_usage (user_id, last_used_at desc);
create index if not exists food_usage_user_freq_idx
  on cadence.food_usage (user_id, use_count desc);

alter table cadence.food_usage enable row level security;
do $$ begin
  create policy food_usage_owner on cadence.food_usage
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- (c) dietary profile — column (matches macro_targets / steer_back pattern). WS5 owns capture.
alter table cadence.users
  add column if not exists dietary_profile jsonb not null
    default '{"allergies":[],"diet":null,"dislikes":[],"notes":null}'::jsonb;

-- (d) correlate a meal logged as N servings of a recipe.
alter table cadence.nutrition_logs
  add column if not exists recipe_id uuid null
    references cadence.recipes (recipe_id) on delete set null;

create index if not exists nutrition_logs_recipe_idx
  on cadence.nutrition_logs (recipe_id)
  where recipe_id is not null;

-- (e) widen recipes.source for chat-built recipes (WS3).
alter table cadence.recipes drop constraint if exists recipes_source_check;
alter table cadence.recipes
  add constraint recipes_source_check
  check (source in ('user', 'ai', 'ai_from_fridge_photo', 'ai_from_chat'));
