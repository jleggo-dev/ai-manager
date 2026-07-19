-- 0006 — P1 brand nomenclature (BRAND.md):
--   1. goals.status  'locked' → 'committed'   ("Set your rhythm", never a cell door)
--   2. equipment.category + 'practice' | 'craft' | 'study'  (mind/practice/learning tools)
--   3. episodes.protect_streak → protect_momentum  (progress never resets to zero)
-- Pre-launch, low/zero rows; every step written defensively. Constraint names are the
-- Postgres auto-names from 0001; apply-migration-0006.ts verifies and adjusts if they differ.

-- 1. goals.status: locked → committed
update cadence.goals set status = 'committed' where status = 'locked';
alter table cadence.goals drop constraint if exists goals_status_check;
alter table cadence.goals add constraint goals_status_check
  check (status in ('captured','confirmed','committed','parked','completed','abandoned'));

-- 2. equipment.category: broaden by addition
alter table cadence.equipment drop constraint if exists equipment_category_check;
alter table cadence.equipment add constraint equipment_category_check
  check (category in ('footwear','cardio','strength','accessory','reading','practice','craft','study','other'));

-- 3. episodes.protect_streak → protect_momentum
alter table cadence.episodes rename column protect_streak to protect_momentum;
