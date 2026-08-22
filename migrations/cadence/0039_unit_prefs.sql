-- 0039 — units, per axis.
--
-- Nobody is wholly metric or wholly imperial. The owner, 2026-08-22, describing his own kitchen
-- and gym: pounds for himself, feet and inches for his height, grams for food, cups and spoons for
-- food volume, kilometres for distance. That is Canada, and Britain, and much of everywhere else —
-- and a single metric/imperial switch cannot express any of it.
--
-- STORAGE STAYS CANONICAL. kg, cm, g, ml, km, always. This column describes DISPLAY only, and
-- every conversion happens at the boundary where a number is shown or handed to the coach. Nothing
-- downstream branches on a unit.
--
-- Nullable, and `baseline.weight_unit` is untouched: every existing user has it, the weigh-in flow
-- and Review both write it, and `resolveUnit` honours it for body weight ahead of the fallback.
-- Dropping it would silently re-metricate everyone who has ever weighed in.
alter table cadence.users
  add column if not exists unit_prefs jsonb;

comment on column cadence.users.unit_prefs is
  'Per-axis DISPLAY units: {system, body_weight, height, food_mass, food_volume, distance}. Storage is always canonical (kg/cm/g/ml/km). An explicit axis beats `system`, which only speaks for axes the user never set. NULL = nothing chosen; see MIXED_DEFAULT in @cadence/shared.';
