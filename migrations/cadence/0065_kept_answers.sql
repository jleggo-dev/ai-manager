-- 0065 — answers kept for a client that comes back, and the start of a coach turn marked on its
-- conversation (the phone being left mid-request, owner 2026-11-03).
--
-- On the phone, switching apps or locking the screen while a food read was in flight killed the
-- read: iOS suspends the webview, the request's socket dies or hangs, and the answer the server
-- was working out had nowhere to go. A read can legitimately take up to 150 s (two model calls
-- and a web lookup for a maker-named food), which is long enough to leave.
--
-- A long request now carries a client-made request id. The route records it here as `running`
-- before the work starts, runs the work whether or not the client is still listening, and writes
-- the answer — or the fault, with the status it would have answered with — BEFORE answering. A
-- client that lost the connection comes back for it (GET /answers/:request_id); one whose request
-- never got through re-sends under the same id and lands on the running row instead of starting
-- a second read (services/kept-answers.ts).
--
-- Rows are short-lived scratch: each claim sweeps the person's rows older than a day. `answer`
-- is the response body as it would have gone out; `fault` is `{status, error}` for an answer
-- the route refused. The key is (user_id, request_id): the id is the client's own, so one
-- person's choice of id can never reach another person's row.
--
-- `turn_started_at`: the coach route marked a turn as in flight only once the provider announced
-- a response id, 5–15 s after the message was sent. A phone that left in that stretch and came
-- back saw "nothing generating" and was told the connection dropped while the reply was on its
-- way. The turn is now marked at route entry and cleared where the response id is cleared, so
-- GET /coach/current says "still writing" for the whole turn (routes/coach.ts).
--
-- Purely additive, house style: `if not exists`, no down-migration, no backfill.
create table if not exists cadence.kept_answers (
  user_id      uuid not null references cadence.users (id) on delete cascade,
  request_id   uuid not null,
  kind         text not null,
  status       text not null check (status in ('running', 'done', 'failed')),
  answer       jsonb,
  fault        jsonb,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  primary key (user_id, request_id)
);

create index if not exists kept_answers_user_started_idx
  on cadence.kept_answers (user_id, started_at);

alter table cadence.kept_answers enable row level security;

drop policy if exists kept_answers_owner on cadence.kept_answers;
create policy kept_answers_owner on cadence.kept_answers
  using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on table cadence.kept_answers is
  'The answer to a long request (a described-meal read, a photo read), kept under the client''s own request id so a phone that left mid-request can come back for it. Written before the route answers; swept after a day. See services/kept-answers.ts.';

alter table cadence.conversations
  add column if not exists turn_started_at timestamptz;

comment on column cadence.conversations.turn_started_at is
  'When the coach turn now in flight began: set at route entry, cleared once the reply is on file or the turn fails. With in_flight_response_id, what GET /coach/current reports as generating.';
