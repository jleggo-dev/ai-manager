-- Observed household weights: "1/4 cup of chopped shallots is about 40 g".
--
-- Owner ruling 2026-08-23: a weight the Coach looks up is written PRIVATELY first, and the shared
-- answer is promoted from the accumulated corpus rather than from one model's first opinion.
-- The rationale is data, not caution -- "the benefit of saving it privately is to gain a large store
-- of data that we can operate on." N independent observations of the same food+measure is something
-- you can take a median of, spot outliers in, and promote a consensus from; a single lookup written
-- straight onto a row every user reads is not.
--
-- This is deliberately NOT a copy of the food. Fragmenting a shared food row per user would break
-- the ledger's whole promise (the same words resolve to the same row forever). A portion is an
-- observation ABOUT a food, so it lives beside it and the food stays one row.
create table if not exists cadence.food_portions (
  portion_id   uuid primary key default gen_random_uuid(),
  food_id      uuid not null references cadence.foods(food_id) on delete cascade,
  user_id      uuid not null,
  -- As the person said it: "1/4 cup", "1 shallot". Stored per SINGLE unit, so priceFood multiplies.
  label        text not null,
  unit         text not null,
  amount_g     numeric not null check (amount_g > 0),
  -- The model's one-line justification, kept so a later reviewer can see why a number looked right.
  basis        text,
  -- 'llm' today. 'user' when someone weighs it themselves, which should outrank everything.
  source       text not null default 'llm',
  created_at   timestamptz not null default now()
);

-- One observation per person per measure per food: a re-lookup updates rather than accumulates,
-- so the corpus counts PEOPLE who agree, not times anyone asked.
create unique index if not exists food_portions_user_food_label_uniq
  on cadence.food_portions (food_id, user_id, lower(label));

-- The read path: every portion this user holds for this food.
create index if not exists food_portions_user_food_idx
  on cadence.food_portions (user_id, food_id);

-- The promotion path: all observations of one food+measure, across users.
create index if not exists food_portions_food_label_idx
  on cadence.food_portions (food_id, lower(label));

alter table cadence.food_portions enable row level security;

drop policy if exists food_portions_owner on cadence.food_portions;
create policy food_portions_owner on cadence.food_portions
  using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on table cadence.food_portions is
  'Per-user observed household weights for a food. Private on write; the shared servings[] entry is promoted from consensus across users. See MP4 in docs/cadence/PLAN.md.';
