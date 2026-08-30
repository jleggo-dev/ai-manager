-- 0046 — the Progress Engine's layout store (docs/cadence/PROGRESS-ENGINE.md "The layout model").
--
-- A layout is an ORDERED list of widget specs the coach composes (WHAT to show); deterministic
-- code renders it (HOW). Lifecycle mirrors cadence.plans: draft → committed, superseded lineage —
-- committing a new layout marks the previous committed row 'superseded' rather than deleting it,
-- so the history of what a user's page looked like is never lost. The DEFAULT composition (no
-- committed row) is computed on read by the deterministic composer and never stored here — this
-- table only holds layouts the coach (via the progress talk, Wave 3) or the user has actually set.
create table if not exists cadence.progress_layouts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references cadence.users (id) on delete cascade,
  status       text not null check (status in ('draft', 'committed', 'superseded')),
  layout       jsonb not null,
  created_at   timestamptz not null default now(),
  committed_at timestamptz
);

create index if not exists progress_layouts_user_idx on cadence.progress_layouts (user_id);

-- One committed layout per user at a time — commitDraft supersedes the prior committed row in the
-- same transaction before inserting/flipping this one, so the constraint should never fire in
-- practice; it exists as the backstop against a concurrent double-commit.
create unique index if not exists progress_layouts_committed_uidx
  on cadence.progress_layouts (user_id) where status = 'committed';
