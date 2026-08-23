-- 0041 — FatSecret as the LAST deterministic rung (SPEC-fatsecret.md; owner ruling 2026-08-22).
--
-- A FatSecret-backed row is NOT a food. It is a POINTER plus a 24-hour cache, and the shape is
-- dictated by their Developer ToS rather than by preference: only identifiers are "storable
-- indefinitely" (food_id, serving_id among them), while names, brands and every nutrient are
-- 24-hour data that must be re-read.
--
-- That sounds fatal to A23's pinned ledger — price it once, keep the number — until you notice the
-- consistency promise was never about caching a VALUE. It is about asking the same question every
-- time, and food_id is exactly what we may keep AND exactly what determines the answer. Pin the
-- reference, re-read the numbers, same price every day.
--
-- Hence `source_fetched_at`: the timestamp is what makes the 24-hour rule enforceable in code
-- instead of a promise in a comment. Rows past it must be refreshed before use, and purged of
-- their perishable fields if the refresh fails.
--
-- Additive + idempotent, safe to re-run.

alter table cadence.foods drop constraint if exists foods_source_check;
alter table cadence.foods
  add constraint foods_source_check
  check (source in ('llm', 'label_photo', 'manual', 'chat', 'usda', 'off', 'fatsecret'));

alter table cadence.foods
  add column if not exists fatsecret_id text null;

-- NULL allowed for every other source (Postgres UNIQUE treats NULLs as distinct), so one shared
-- row per FatSecret food and no duplicates however many users reach it.
create unique index if not exists foods_fatsecret_id_uidx on cadence.foods (fatsecret_id);

/*
 * When the perishable half of this row was last read from source. NULL for sources with no expiry
 * — USDA is public domain and Open Food Facts is ODbL, so both keep their numbers indefinitely.
 */
alter table cadence.foods
  add column if not exists source_fetched_at timestamptz null;

-- The refresh sweep's access pattern: stale FatSecret rows, oldest first.
create index if not exists foods_fatsecret_stale_idx
  on cadence.foods (source_fetched_at)
  where source = 'fatsecret';
