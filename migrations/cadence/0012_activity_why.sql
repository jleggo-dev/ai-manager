-- 0012: per-commitment rationale, persisted.
-- The synthesized "why" (one coach-voiced line per activity) was preview-only; persisting it
-- lets the coach walk the committed plan's ladder in chat and the session sheet say why a
-- session exists. Nullable — plans committed before this feature simply have no stored why.
alter table cadence.activities add column if not exists why text;
