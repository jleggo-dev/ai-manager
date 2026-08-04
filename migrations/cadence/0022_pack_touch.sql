-- 0022_pack_touch.sql
-- P3 of the context/memory architecture: the invalidation rule for context-pack REUSE.
--
-- A coach turn's briefing (the context pack) costs two Broker calls to build. Reuse is only safe
-- if the pack provably reflects every write that changes what the dossier says — a coach on a
-- stale briefing forgets what you just told it, which is precisely "making you repeat yourself"
-- (the brand's loudest promise). App-side invalidation calls were rejected for the same reason
-- listForCoach enforces privacy in SQL: one missed call site IS the bug, silently. Triggers make
-- the watermark mechanical.
--
-- users.pack_touched_at is the single per-user watermark. Every dossier-relevant table touches it
-- on write; a pack is reusable only when built AFTER greatest(pack_touched_at, users.updated_at)
-- (users' own dossier writes — name/baseline/macro_targets — already bump updated_at).
--
-- occurrences is the one table with a churn problem: `session` is a regenerable prescription
-- CACHE written by prefetch on ordinary plan opens, and `weather`/`provenance` are ambient — so
-- its UPDATE trigger fires only when a dossier-real column changes (status, value, log, date,
-- episode_id). Without that WHEN clause, every plan open would invalidate every pack and reuse
-- would never hit.

alter table cadence.users add column if not exists pack_touched_at timestamptz not null default now();

create or replace function cadence.touch_pack() returns trigger
language plpgsql as $$
begin
  update cadence.users set pack_touched_at = now()
  where id = coalesce(new.user_id, old.user_id);
  return null;
end $$;

-- Unconditional: every write to these is dossier-relevant.
do $$
declare t text;
begin
  foreach t in array array['goals','plans','activities','equipment','nutrition_logs',
                          'journal_entries','episodes','check_ins','goal_events']
  loop
    execute format('drop trigger if exists pack_touch on cadence.%I', t);
    execute format(
      'create trigger pack_touch after insert or update or delete on cadence.%I
         for each row execute function cadence.touch_pack()', t);
  end loop;
end $$;

-- occurrences: inserts/deletes always; updates only when a dossier-real column changed.
drop trigger if exists pack_touch_ins_del on cadence.occurrences;
create trigger pack_touch_ins_del after insert or delete on cadence.occurrences
  for each row execute function cadence.touch_pack();
drop trigger if exists pack_touch_upd on cadence.occurrences;
create trigger pack_touch_upd after update on cadence.occurrences
  for each row
  when (old.status is distinct from new.status
     or old.value  is distinct from new.value
     or old.log    is distinct from new.log
     or old.date   is distinct from new.date
     or old.episode_id is distinct from new.episode_id)
  execute function cadence.touch_pack();
