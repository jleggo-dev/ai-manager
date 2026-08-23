-- 0042 — the Canadian Nutrient File as a bulk-imported corpus, and 'research' as a pin source.
--
-- CNF (Health Canada) is 5,690 foods with full laboratory panels — measured average 106 nutrient
-- rows per food, all seven tracked micronutrients, household measures, Open Government Licence so
-- the numbers may be stored forever. Its API is dump-shaped (no search endpoint), which decides
-- the integration: it is not a runtime rung, it is DATA. One import script, shared rows, and every
-- lookup lands in the first rung (local search) at zero latency with no availability dependency.
--
-- 'research' marks a pinned food whose numbers came from a web-grounded AI lookup rather than the
-- parse's guess. The lookup runs ONCE — the pin is precisely what makes an unstable source safe,
-- because the same question is never asked twice.
--
-- Additive + idempotent, safe to re-run.

alter table cadence.foods drop constraint if exists foods_source_check;
alter table cadence.foods
  add constraint foods_source_check
  check (source in ('llm', 'label_photo', 'manual', 'chat', 'usda', 'off', 'fatsecret', 'cnf', 'research'));

-- CNF's own food_code — the conflict key that makes the import re-runnable.
alter table cadence.foods
  add column if not exists cnf_id integer null;

create unique index if not exists foods_cnf_id_uidx on cadence.foods (cnf_id);
