-- 0004 — Brand nomenclature migration (BRAND.md, 2026-07-04):
--   1. goals.category → goals.area with the broadened area enum
--      (movement | nourishment | mind | practice). 'weight' dies as a category —
--      a weight target is a numeric measure.target on a goal, not an area of life.
--   2. users.baseline: injuries[] + free-text constraints[] unify into
--      constraints: [{ id, label, kind: physical|life|other, plan_around }].
-- Pre-launch: dev accounts were reset (0 goal rows), but every step is written
-- defensively so rows created mid-migration are mapped, not lost.

-- ── 1. goals.category → goals.area ─────────────────────────────────────
alter table cadence.goals rename column category to area;

-- Map any legacy values before tightening the CHECK (defensive; expect 0 rows).
update cadence.goals set area = case area
  when 'fitness'   then 'movement'
  when 'nutrition' then 'nourishment'
  when 'weight'    then 'nourishment'
  when 'habit'     then 'practice'
  else area end
where area in ('fitness','nutrition','weight','habit');

alter table cadence.goals drop constraint if exists goals_category_check;
alter table cadence.goals add constraint goals_area_check
  check (area in ('movement','nourishment','mind','practice'));

-- ── 2. baseline: injuries[] + constraints[] → unified Constraint[] ────
-- Old injuries [{area, condition, plan_around}] → {label: "area — condition", kind: 'physical'}.
-- Old free-text constraints ["busy mornings"]   → {label, kind: 'life', plan_around: false}.
update cadence.users
set baseline = (baseline - 'injuries' - 'constraints') || jsonb_build_object(
  'constraints',
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', coalesce(nullif(i->>'id',''), gen_random_uuid()::text),
      'label', trim(both ' —' from concat(i->>'area', ' — ', i->>'condition')),
      'kind', 'physical',
      'plan_around', coalesce((i->>'plan_around')::boolean, false)))
    from jsonb_array_elements(coalesce(baseline->'injuries','[]'::jsonb)) i
  ), '[]'::jsonb)
  ||
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', gen_random_uuid()::text,
      'label', c.value,
      'kind', 'life',
      'plan_around', false))
    from jsonb_array_elements_text(coalesce(baseline->'constraints','[]'::jsonb)) c
    where jsonb_typeof(baseline->'constraints') = 'array'
      and jsonb_typeof(coalesce(baseline->'constraints'->0,'null'::jsonb)) = 'string'
  ), '[]'::jsonb)
)
where baseline ? 'injuries' or (
  baseline ? 'constraints'
  and jsonb_typeof(coalesce(baseline->'constraints'->0,'null'::jsonb)) = 'string'
);
