-- 0054 — repertoire: four standings, each one an instruction to the coach.
-- Idempotent, safe to re-run. NOT applied by this change — see PR notes.
--
-- Owner design 2026-09-02: "a standing is an instruction to the coach, not a label." 0045 shipped
-- three states that only described an item; these four each answer a planning question, so the
-- word on the row is enough to decide what happens to the item next:
--
--   queued  ("Up next")     yet to learn, in the user's order. She proposes the top one when
--                           something is learned, and never starts one unasked.
--   working ("Learning")    the learn part of each session. One or two at a time.
--   known   ("Keeping up")  learned and in the rotation — the warm-up and play-out pool, rested
--                           longest first. The settled tempo (meta.tempo_bpm) lives on these.
--   retired ("Learned")     finished, not revisited. Counted in Progress, never scheduled. One
--                           tap brings it back to Keeping up.
--
-- 'parked' is DROPPED rather than renamed. It said "set aside", which is not a plan — so a paused
-- piece becomes 'queued' and keeps its weeks: it is simply one they have yet to get back to. That
-- is the backfill below, and it is why the drop comes first (the 0045 constraint does not permit
-- 'queued', so the update would fail underneath it).
--
-- Nothing else on the table moves: `status` keeps its 'working' default (a newly mentioned item is
-- being learned unless she says otherwise), and both 0045 indexes stand — repertoire_user_label_uidx
-- is on lower(label) and repertoire_user_status_idx is on (user_id, status, last_practiced_at);
-- neither names a status VALUE, so re-pointing the constraint leaves them valid.
--
-- `learned_at` is untouched on purpose. It marks the crossing into Keeping up that happened in
-- front of us, and retiring a piece keeps it — "learned this year" must never shrink because
-- someone stopped revisiting something. A row that was backfilled as already-known still has no
-- learned_at, and retiring it does not invent one.

-- Drop the old check BY WHAT IT SAYS, not by what we expect it to be called. 0045 wrote it inline
-- on the column, so its name is whatever Postgres auto-generated (repertoire_status_check on a
-- clean build) — and 0006 already hit the case where an auto-name differed and needed a script to
-- go looking. Dropping by name alone would be a silent no-op on such a database: the backfill
-- would be a no-op too whenever no rows are parked, and the stale constraint would survive to
-- reject every 'queued' and 'retired' write afterwards. Matching on the definition cannot miss it.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'cadence.repertoire'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%parked%'
  loop
    execute format('alter table cadence.repertoire drop constraint %I', c.conname);
  end loop;
end $$;

update cadence.repertoire set status = 'queued', updated_at = now() where status = 'parked';

alter table cadence.repertoire drop constraint if exists repertoire_status_check;
alter table cadence.repertoire add constraint repertoire_status_check
  check (status in ('queued', 'working', 'known', 'retired'));

comment on column cadence.repertoire.status is
  'standing, as an instruction: queued = yet to learn (Up next), working = the learn part of a session (Learning), known = in the rotation pool (Keeping up), retired = finished and never scheduled (Learned). Written by update_repertoire; the rotation (pickDueNext) reads only known.';
