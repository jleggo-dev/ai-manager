-- 0027 — the coach's face, plus the two signals her moments capture.
-- Additive and idempotent; safe to re-run.
--
-- Three things, deliberately separate:
--
--   users.coach_face_id   WHICH PORTRAIT the user picked. Nullable, and null is a real answer
--                         ("hasn't picked") that every surface renders as the Metronome Split
--                         mark. Nothing else reads this column: a face is a picture, not a
--                         personality, so it must never reach a prompt, a plan or a signal.
--                         Text rather than an enum on purpose — the set of faces is product
--                         copy that will churn, and a withdrawn portrait should degrade to the
--                         brand mark on read, not fail a CHECK on an existing row.
--
--   session_feedback      HOW IT FELT. The only thing the walkthrough's own StepLogs cannot
--                         see; everything objective (rounds, minutes, skipped steps) is already
--                         known and is never asked for. One row per answered session — an
--                         unanswered session simply has no row, because "didn't answer" and
--                         "answered neutral" are different facts and collapsing them would
--                         quietly invent consistency data.
--
--   daily_checkins        The once-a-day ask. Primary-keyed on (user_id, date) so the gate is
--                         the schema's job, not the scheduler's: a client that fires twice
--                         cannot produce two prompts for one day, and "Not now" is a real row
--                         (dismissed_at set, mood null) so it suppresses today without ever
--                         reading as a mood of zero.

alter table cadence.users add column if not exists coach_face_id text;

-- ── How the session felt (§ post-activity + mind-pillar moments) ───────────
create table if not exists cadence.session_feedback (
  feedback_id   uuid primary key default gen_random_uuid(),
  user_id       uuid not null references cadence.users (id) on delete cascade,
  -- Nullable: an ad-hoc session logged from the ＋ sheet has no occurrence to hang off, and
  -- its felt-state is worth just as much as a planned one's.
  occurrence_id uuid references cadence.occurrences (occurrence_id) on delete cascade,
  -- Which question was asked. Movement asks effort; mind asks felt state. Enforced below.
  kind          text not null check (kind in ('movement', 'mind')),
  rpe           text check (rpe in ('too_easy', 'just_right', 'too_hard')),
  felt_state    text check (felt_state in ('calmer', 'same', 'more_wound_up')),
  -- Movement only, and only when steps were actually skipped. There is deliberately no mind
  -- equivalent: a stopped breath session is a completed rep, and asking why frames it as a skip.
  reason_code   text check (reason_code in ('no_time', 'body_off', 'not_feeling_it')),
  created_at    timestamptz not null default now(),
  -- The answer has to match the question. Without this a mind session could carry an RPE and
  -- the weekly check-in would read it as effort data.
  constraint session_feedback_kind_matches_answer check (
    (kind = 'movement' and felt_state is null) or
    (kind = 'mind' and rpe is null and reason_code is null)
  )
);
create index if not exists session_feedback_user_created_idx
  on cadence.session_feedback (user_id, created_at desc);
-- One answer per session — re-answering updates rather than appending a second opinion.
create unique index if not exists session_feedback_occurrence_idx
  on cadence.session_feedback (occurrence_id) where occurrence_id is not null;

-- ── The daily check-in (§ first open of the day) ───────────────────────────
create table if not exists cadence.daily_checkins (
  user_id      uuid not null references cadence.users (id) on delete cascade,
  -- The user's LOCAL date, resolved server-side from their timezone. Storing a date (not a
  -- timestamp) is what makes "once a day" mean their day rather than UTC's.
  date         date not null,
  mood         smallint check (mood between 1 and 5),
  adjustment   text check (adjustment in ('keep', 'lighter', 'earlier')),
  -- Set when the user chose "Not now". Suppresses today and nothing further — the next day
  -- is a fresh row, so dismissing never compounds into never being asked again.
  dismissed_at timestamptz,
  created_at   timestamptz not null default now(),
  primary key (user_id, date)
);
