-- 0036 — a commitment identity that survives Apply (PLAN.md A19).
--
-- Every Apply supersedes the plan and INSERTS FRESH activity rows, so `activity_id` is stable only
-- within one plan version. Nothing survived a version bump except the TITLE — a mutable,
-- model-generated, freely-duplicable string that was silently carrying identity for three separate
-- jobs at once: addressing an edit, joining six weeks of occurrences into one history, and dedup.
-- Renaming a commitment split its history in two and nothing errored.
--
-- `commitment_id` is that identity, copied forward at commit instead of minted fresh.
--
-- Additive + idempotent, safe to re-run.

alter table cadence.activities add column if not exists commitment_id uuid;

-- Backfill: group a user's rows by title across ALL plan versions, which is the last time that
-- heuristic gets to matter.
--
-- The slot is why this is not a one-liner. A plan can already hold two rows with the SAME title
-- (2026-08-17: one card renamed Tuesday's run "Easy run" while adding a Wednesday "Easy run"), and
-- collapsing those onto one commitment_id would make them indistinguishable again — reintroducing,
-- in the new column, the exact bug this column exists to end. So the Nth same-titled row within a
-- plan joins the Nth lineage: identical titles in one plan stay distinct, and the same title across
-- versions still lines up.
--
-- Known imperfection, accepted: for a same-titled PAIR, which one continued which across versions
-- is not recoverable from the data — slot order is `activity_id`, which is arbitrary, and ordering
-- by schedule instead would break every commitment that legitimately changed days. So twins may
-- have their two histories crossed at the version where they appeared. Verified on the only real
-- instance (2026-08-17, two "Easy run" rows a day old, no history to speak of). Everything that is
-- not a twin — the overwhelming majority — threads cleanly: "Long run" collapsed to ONE lineage
-- across all eight of its versions.
with slotted as (
  select
    activity_id,
    user_id,
    lower(btrim(title)) as norm_title,
    row_number() over (
      partition by user_id, lower(btrim(title)), plan_id
      order by activity_id
    ) as slot
  from cadence.activities
  where commitment_id is null
),
lineage as (
  select user_id, norm_title, slot, gen_random_uuid() as cid
  from slotted
  group by user_id, norm_title, slot
)
update cadence.activities a
   set commitment_id = l.cid
  from slotted s
  join lineage l
    on l.user_id = s.user_id and l.norm_title = s.norm_title and l.slot = s.slot
 where a.activity_id = s.activity_id;

-- A row that names no lineage is a genuinely NEW commitment, so minting one is the right default
-- and NOT NULL can hold from here on.
alter table cadence.activities alter column commitment_id set default gen_random_uuid();
alter table cadence.activities alter column commitment_id set not null;

-- History is now a real join instead of a string match; this is the index it runs on.
create index if not exists activities_user_commitment_idx
  on cadence.activities (user_id, commitment_id);
