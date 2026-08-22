-- 0039 — food search that finds it, and a ledger that knows your week (A23 §1c).
--
-- Two problems, one migration.
--
-- (a) SEARCH. `searchFoods` was `lower(name) like '%q%'` with no index — fine for a few hundred
--     private rows, useless the moment USDA Branded lands (~450k). Trigram GIN indexes make the
--     substring scan an index lookup AND unlock fuzzy matching, so "greek yogurt" still finds
--     "Yogurt, Greek, plain" and a typo does not dead-end into "add a new food".
--
-- (b) RHYTHM. The owner goes into work on Wednesdays and eats a parfait from the café next door.
--     A flat recents list buries it under six days of home breakfasts, so he ends up searching for
--     a food he has logged twenty times — the MyFitnessPal chore this product exists to delete.
--     `food_usage` counts THAT you ate something; `food_usage_ctx` counts WHEN, which is what makes
--     "your usual Wednesday parfait" a deterministic lookup instead of a guess. The product is
--     named for this: a rhythm you can keep.
--
-- Additive + idempotent, safe to re-run. No backfill: the context table earns its rows from the
-- next log onward, and an empty one simply scores nothing (the ranker degrades to today's order).

-- (a) ── trigram search ───────────────────────────────────────────────────────────────────────
-- `extensions` schema to match pgcrypto / uuid-ossp here, and it is already on the search_path,
-- so `similarity()` and `gin_trgm_ops` resolve unqualified.
create extension if not exists pg_trgm with schema extensions;

create index if not exists foods_name_trgm_idx
  on cadence.foods using gin (lower(name) extensions.gin_trgm_ops);
create index if not exists foods_brand_trgm_idx
  on cadence.foods using gin (lower(coalesce(brand, '')) extensions.gin_trgm_ops);

-- (b) ── when you eat what ────────────────────────────────────────────────────────────────────
-- Deliberately a SECOND table rather than columns on food_usage: that one answers "how often, how
-- recently" for the whole app and must stay one row per food. This one is a per-slot histogram, so
-- a food you eat every morning and occasionally at night ranks correctly at both times.
--
-- dow is 0-6 Sunday-first, derived from the log's UTC date — the same day-stamp every other
-- Cadence surface uses, so a meal cannot land in one day here and another day there.
create table if not exists cadence.food_usage_ctx (
  user_id      uuid not null references cadence.users (id) on delete cascade,
  food_id      uuid not null references cadence.foods (food_id) on delete cascade,
  dow          smallint not null check (dow between 0 and 6),
  meal         text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other')),
  use_count    int not null default 1,
  last_used_at timestamptz not null default now(),
  primary key (user_id, food_id, dow, meal)
);

-- The lookup the ranker makes on every resolve: this user, this weekday, this meal.
create index if not exists food_usage_ctx_slot_idx
  on cadence.food_usage_ctx (user_id, dow, meal);
-- And the weaker "you have this for breakfast" signal, any day.
create index if not exists food_usage_ctx_meal_idx
  on cadence.food_usage_ctx (user_id, meal);

alter table cadence.food_usage_ctx enable row level security;
do $$ begin
  create policy food_usage_ctx_owner on cadence.food_usage_ctx
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
