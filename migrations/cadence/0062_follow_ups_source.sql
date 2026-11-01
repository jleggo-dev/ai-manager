-- 0062 — where a follow-up came from, the evidence behind it, and the week the fact review ran.
--
-- HARNESS-V3 C7 (P9, 2026-10-31). The dossier grows for months and its facts start to disagree:
-- "has a gym membership" from February beside a June note that the gym closed. A weekly job,
-- `fact-review`, reads one person's facts when their weekly check-in closes and returns what it
-- found — a contradiction, a fact a later one has overtaken, or one thing told twice — each with
-- the facts it rests on. It never edits a fact. Each finding becomes a follow-up (0061): a plain
-- question the coach can raise in her own words when it fits, and the person's answer goes
-- through the normal capture or Settings path like anything else they tell her.
--
-- `source` says who put a follow-up there: 'coach' (she noted it through note_follow_up — every
-- row before this migration, hence the default) or 'fact-review' (the weekly job). `evidence` is
-- the job's reason, quoting the facts — kept beside the question so anyone looking at a row can
-- see why it was asked. Null for the coach's own rows; she gives none.
--
-- `recaps.fact_reviewed_at` is the run guard: the check-in close claims its recap week by setting
-- it, so a second confirm of the same week (a double tap, a re-confirm) never runs the review
-- twice. On the recap rather than on the user row because the recap IS the check-in close, and so
-- the guard never writes to the row that holds the facts being reviewed.
--
-- Purely additive, house style: `if not exists`, no down-migration, no backfill (the default fills
-- existing rows as 'coach', which is what they are).
alter table cadence.follow_ups
  add column if not exists source text not null default 'coach'
    check (source in ('coach', 'fact-review'));
alter table cadence.follow_ups add column if not exists evidence text;

alter table cadence.recaps add column if not exists fact_reviewed_at timestamptz;
