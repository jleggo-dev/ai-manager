-- 0010 — Fitness module (Prescribe → Log → Adapt), spec §5.5 extension:
--   occurrences.session — the coach's generated per-day prescription (blocks of items with
--     sets/reps/load/etc). A REGENERABLE CACHE: replan deletes future pending occurrences and
--     the session regenerates lazily on next open; never referenced durably elsewhere.
--   occurrences.log — the user's structured post-session report (parsed from their own words).
--     Durable history; numeric rollups continue to live in the existing `value` column.
-- Purely additive.
alter table cadence.occurrences
  add column if not exists session jsonb,
  add column if not exists log jsonb;
