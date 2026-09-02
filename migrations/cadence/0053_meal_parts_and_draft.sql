-- Meal-logging rework (2026-09-02): the meal is the unit of the write.
--
-- 1. Parts: a meal contains items and recipe-instances ("parts", the bracket). Items are jsonb so
--    only the parts array itself needs a column. Every item.part references a parts[].key.
-- 2. Draft lifecycle (1b — the meal is the screen): a meal opens, accepts adds for a visible
--    window, then closes. Legacy rows default to 'closed'; open meals count toward the day marked
--    OPEN. An abandoned empty draft is deleted at expiry — it never becomes a diary row.
-- 3. The Sunday sweep rail: per-feature pending jsonb on users + a throttle stamp, the same shape
--    pending_proposal / pending_week_review already use.

alter table cadence.nutrition_logs
  add column if not exists parts jsonb not null default '[]'::jsonb,
  add column if not exists state text not null default 'closed',
  add column if not exists closes_at timestamptz;

alter table cadence.nutrition_logs
  drop constraint if exists nutrition_logs_state_check;
alter table cadence.nutrition_logs
  add constraint nutrition_logs_state_check check (state in ('open', 'closed'));

-- The open-draft lookup ("is there a breakfast still accepting adds?") — tiny partial index.
create index if not exists nutrition_open_idx
  on cadence.nutrition_logs (user_id)
  where state = 'open';

alter table cadence.users
  add column if not exists pending_food_sweep jsonb,
  add column if not exists last_food_sweep_at timestamptz;
