-- 0040 — where you LIVE and where you ARE stop being the same column (A21).
--
-- `home_location` has been doing two jobs since 0001: the anchor notifications schedule against
-- (`notify-candidates.ts` reads it to decide what "morning" means for you) and the point the Today
-- header draws its weather and city from. Those two want opposite things. The header wants to
-- follow you downtown; the anchor must not, or a daily commute walks "home" back and forth across
-- the island and takes every notification time with it.
--
-- So the header gets its own column. `current_location` is TRANSIENT by contract: it is written
-- when you have plainly settled somewhere else (5 km away, still there twenty minutes later), it
-- is cleared the moment you are home again, and NOTHING but the header's weather + city is allowed
-- to read it. `home_location` keeps every other caller it already had.
--
-- Shape: { lat, lon, label?, at } — `at` is the ISO time we committed it, which is what lets a
-- later reader reason about staleness without a second column to keep in step.
--
-- Additive + idempotent, safe to re-run. No backfill: a null simply means "you are home", which is
-- the correct answer for every existing row.

alter table cadence.users
  add column if not exists current_location jsonb;

comment on column cadence.users.current_location is
  'Transient position for the Today header''s weather + city ONLY (A21). Null means "at home". '
  'Never read this for notification anchoring or planning — that is home_location''s job.';
