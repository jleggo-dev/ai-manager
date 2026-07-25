-- 0018 — Req 5 Phase 3: USDA FoodData Central backbone (whole foods).
-- Adds source='usda' + dedicated fdc_id (do not overload off_id).
-- Additive + idempotent; safe to re-run.

alter table cadence.foods drop constraint if exists foods_source_check;
alter table cadence.foods
  add constraint foods_source_check
  check (source in ('llm', 'label_photo', 'manual', 'chat', 'usda', 'off'));

alter table cadence.foods
  add column if not exists fdc_id integer null;

-- NULL allowed for non-USDA rows (Postgres UNIQUE treats NULLs as distinct).
create unique index if not exists foods_fdc_id_uidx on cadence.foods (fdc_id);

create index if not exists foods_source_usda_idx on cadence.foods (source)
  where source = 'usda';
