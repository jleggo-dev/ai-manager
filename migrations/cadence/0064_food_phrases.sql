-- 0064 — the phrase memory for described meals (docs/cadence/FOOD-LOGGING-COACH-LED.md, build
-- step 2, 2026-11-01).
--
-- A meal someone types or says is read by the food-check model: software looks every part up,
-- one call picks a record and a measure, the store prices it. The pick is remembered here, by
-- the words it was said in, so the same words next time are a deterministic hit and no call at
-- all ("Logged, and learned"). The row is written when the meal is confirmed, never on a
-- preview that was walked away from.
--
-- `phrase` is normalised before it is stored (services/food-phrases.ts: lowercase, accents
-- folded, the amount peeled off), so "Starbucks venti latte" and "starbucks  Venti Latte" are one
-- row. `qty`/`unit` are the row the pick landed as, in the food's own measure or in grams — the
-- same shape nutrition_logs.items carries — so a hit prices through priceFood like any saved food.
-- A later confirm of the same words overwrites the pick: the newest choice is the person's usual.
--
-- Purely additive, house style: `if not exists`, no down-migration, no backfill.
create table if not exists cadence.food_phrases (
  phrase_id    uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  phrase       text not null,
  food_id      uuid not null references cadence.foods(food_id) on delete cascade,
  qty          numeric not null check (qty > 0),
  unit         text,
  uses         int not null default 1,
  last_used_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create unique index if not exists food_phrases_user_phrase_uniq
  on cadence.food_phrases (user_id, phrase);

alter table cadence.food_phrases enable row level security;

drop policy if exists food_phrases_owner on cadence.food_phrases;
create policy food_phrases_owner on cadence.food_phrases
  using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on table cadence.food_phrases is
  'What a person''s own words for a food resolved to, once the coach checked it and they confirmed. The deterministic rung for described meals: a hit here prices with no model call. See docs/cadence/FOOD-LOGGING-COACH-LED.md.';
