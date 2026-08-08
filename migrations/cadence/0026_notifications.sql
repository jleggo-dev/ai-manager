-- 0026 — notification preferences + delivery log (push framework, phase 1).
-- Additive and idempotent; safe to re-run.
--
-- Two tables, two jobs:
--
--   notification_prefs  WHO may be sent to, and WHEN it is acceptable. One row per user,
--                       created lazily on first read so nothing needs backfilling.
--
--   notifications       WHAT was actually sent. This is the idempotency ledger, not an audit
--                       nicety: the scheduler is a cron tick that can fire late, twice, or
--                       overlap itself, and without a unique key on (user, kind, target) a
--                       retry buzzes someone's phone a second time. A duplicate push is the
--                       most expensive bug this system can have — it is unrecallable and it
--                       lands on a lock screen.

create table if not exists cadence.notification_prefs (
  user_id           uuid primary key references cadence.users(id) on delete cascade,
  -- Master switch. Off until the user opts in on-device; the OS permission is separate and
  -- authoritative, but this lets someone keep the OS permission while muting Cadence.
  enabled           boolean     not null default false,
  -- Quiet hours as local wall-clock minutes-from-midnight, evaluated in the user's own
  -- timezone. Stored as minutes (not a time) so the window can wrap midnight with plain
  -- integer maths and no date arithmetic. Default 21:00 -> 07:00.
  quiet_start_min   integer     not null default 1260,
  quiet_end_min     integer     not null default 420,
  -- Per-kind opt-outs, e.g. {"session_reminder": false}. Absent key = allowed.
  kinds             jsonb       not null default '{}'::jsonb,
  -- Belt-and-braces cap so a scheduler bug cannot spam. Enforced in app code.
  max_per_day       integer     not null default 3,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint notification_prefs_quiet_start_range check (quiet_start_min between 0 and 1439),
  constraint notification_prefs_quiet_end_range   check (quiet_end_min   between 0 and 1439),
  constraint notification_prefs_max_per_day_range check (max_per_day between 0 and 20)
);

create table if not exists cadence.notifications (
  notification_id uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references cadence.users(id) on delete cascade,
  -- e.g. 'session_reminder'. Deliberately free text: adding a kind must not need a migration.
  kind            text        not null,
  -- The thing this notification is ABOUT, as a stable string the caller chooses (an ISO date,
  -- an occurrence id). Together with (user_id, kind) it is the idempotency key.
  target          text        not null,
  title           text        not null,
  body            text        not null,
  -- 'sent' | 'failed' | 'skipped'. 'skipped' rows are written on purpose: knowing we chose
  -- NOT to send (quiet hours, cap, disabled) is what makes "why didn't I get it?" answerable,
  -- and it still occupies the idempotency slot so the tick does not reconsider it all day.
  status          text        not null,
  detail          text,
  created_at      timestamptz not null default now(),
  constraint notifications_status_check check (status in ('sent', 'failed', 'skipped'))
);

-- THE idempotency guard. Insert-first, then send: if this raises a conflict, another tick
-- already owns this (user, kind, target) and we do nothing.
create unique index if not exists notifications_user_kind_target_key
  on cadence.notifications (user_id, kind, target);

-- Daily-cap counting and the "what did we send this user" view.
create index if not exists notifications_user_created_idx
  on cadence.notifications (user_id, created_at desc);

alter table cadence.notification_prefs enable row level security;
alter table cadence.notifications       enable row level security;

-- RLS on with NO policy, matching cadence.weather_cache (0025): the `cadence` schema is not
-- exposed to the Data API and every read goes through the API's own user scoping, so any
-- policy here would be a second, weaker copy of that rule.

-- NOT wired to the 0022 pack_touch watermark on purpose: a notification is not context the
-- coach reasons over, and touching the watermark on every send would invalidate the user's
-- context pack for no reason.
