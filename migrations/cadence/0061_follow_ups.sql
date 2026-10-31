-- 0061 — follow_ups: the things the coach said she would come back to.
--
-- HARNESS-V3 C3 (2026-10-31). "Never makes you repeat yourself" has depended on one session's
-- rolling summary, which keeps "anything still open" — and dies when the session goes stale after
-- seven idle days. A promise she made on a Tuesday ("ask me again after the 18K") was gone by the
-- next conversation. This is the durable half: one row per thing she said she would come back to,
-- written by HER through note_follow_up (coach-action-follow-ups.ts) — never inferred by capture —
-- and read into every turn's context (retrieval/follow-ups-function.ts) until she or the person
-- closes it, or it expires at 90 days.
--
-- `closed_by` says who: 'coach' through close_follow_up, 'user' reserved for a Settings list that
-- does not exist yet (R3), 'expired' when 90 days pass with nobody closing it — written on the
-- next note, not on read, so reads stay pure. `outcome` is her words for how it ended, when she
-- gave any.
--
-- FK to cadence.users, not auth.users (decoupled in 0002). Purely additive, house style: `if not
-- exists`, no down-migration, no backfill.
create table if not exists cadence.follow_ups (
  follow_up_id uuid primary key default gen_random_uuid(),
  user_id      uuid not null references cadence.users (id) on delete cascade,
  text         text not null,
  due_on       date,
  created_at   timestamptz not null default now(),
  closed_at    timestamptz,
  closed_by    text check (closed_by in ('coach', 'user', 'expired')),
  outcome      text,
  constraint follow_ups_closed_pair check ((closed_at is null) = (closed_by is null))
);
create index if not exists follow_ups_open_idx on cadence.follow_ups (user_id, created_at desc)
  where closed_at is null;

alter table cadence.follow_ups enable row level security;
do $$ begin
  create policy follow_ups_owner on cadence.follow_ups
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- Dossier-relevant (get_follow_ups renders it into the pack) → joins the pack-touch watermark
-- family from 0022, or a follow-up noted today would not show until the pack expired.
drop trigger if exists pack_touch on cadence.follow_ups;
create trigger pack_touch after insert or update or delete on cadence.follow_ups
  for each row execute function cadence.touch_pack();
