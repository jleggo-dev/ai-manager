-- 0047 — the Progress Engine's recap store (docs/cadence/PROGRESS-ENGINE.md "Check-in
-- unification"): confirming a week review writes a compact recap artifact here, so the
-- `recap_rail` widget has something to read without re-deriving it from occurrences every time.
--
-- `facts` is a COMPACT snapshot (kept/scheduled sessions, meals logged/total, the weigh-in trend
-- delta when one exists) — not the full day-by-day grid week-review-facts.ts already computes for
-- the review sheet itself; that grid stays derived-on-read, this is the small durable receipt.
-- `facts_line` is the deterministic one-liner built server-side from that snapshot ("showed up 4
-- of 5 · 19 of 21 meals · -0.4 lb", tabular parts omitted when absent — never "adherence",
-- "streak", or a value judgment on the number). `line` is the coach's/receipt's one-sentence
-- conclusion when the confirm carries one — nullable, honest v1: today's confirm flow hands its
-- receipt to the coach visibly (chat) but nothing yet writes a conclusion back to the server, so
-- most rows land with `line` null until that wiring lands (W2-2 / Wave 3). `detour` is a plain
-- flag (an episode overlapping the week), never a failure state.
--
-- week_start is the Monday on/before the reviewed window's start — the same Monday-start week
-- convention services/progress-rhythm.ts already buckets the rhythm widget by, so a recap lines up
-- with the week it visually sits under everywhere else in Progress. UNIQUE (user_id, week_start):
-- a re-confirm of the same week upserts rather than duplicating.
--
-- Purely additive. House style from 0044/0045: `if not exists` guards, no down-migration.
create table if not exists cadence.recaps (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references cadence.users (id) on delete cascade,
  week_start   date not null,
  facts        jsonb not null,
  facts_line   text not null,
  line         text,
  detour       boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Also serves listRecaps' (user_id, week_start desc) read — a single index does both jobs.
create unique index if not exists recaps_user_week_uidx on cadence.recaps (user_id, week_start);
