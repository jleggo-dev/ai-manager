-- 0025 — weather_cache: shared (NOT per-user) weather snapshots, so the cache survives restarts
-- and is shared across instances.
--
-- Why: the cache was a process-local in-memory Map. On Vercel Services every cold start or extra
-- instance began empty and re-fetched, multiplying provider calls for no reason — the binding
-- constraint once weather moves to WeatherKit, whose free tier is metered (500k/month). The
-- in-memory Map stays in front of this as an L1; this table is the L2 that all instances share.
--
-- This table is deliberately UNLIKE every other cadence table:
--   * NO user_id. The key is `roundedLat,roundedLon:localDate` (~11 km bucket) — weather is a
--     property of a PLACE, not a person, so everyone in the same cell shares one row. That
--     sharing IS the cost saving; scoping it per user would defeat the whole point.
--   * NO pack_touch trigger (0022). Weather is ambient, not dossier data. Wiring it to the
--     watermark would invalidate EVERY user's context pack on EVERY weather fetch — the exact
--     churn 0022's `occurrences` WHEN-clause exists to prevent.
--   * RLS enabled with NO policy: deny-all for the Data API roles. The `cadence` schema isn't
--     exposed to the Data API anyway (a trusted backend talks to Postgres directly), so this is
--     belt-and-braces — and since there's no owner column, there is no policy that would be
--     correct to write.
--
-- `snapshot` is the mapped WeatherSnapshot, stored whole so a provider change (OWM → WeatherKit)
-- is a value change, not a migration.

create table if not exists cadence.weather_cache (
  cache_key   text primary key,
  snapshot    jsonb not null,
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

-- Serves both the read filter (expires_at > now()) and the prune sweep.
create index if not exists weather_cache_expires on cadence.weather_cache (expires_at);

alter table cadence.weather_cache enable row level security;
