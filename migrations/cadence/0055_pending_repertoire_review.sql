-- 0055 — the seed-review pointer: cadence.users gains pending_repertoire_review (which collection
-- the coach's `offer_repertoire_review` tool last offered to lay out, and where in it the person
-- said they are). Same shape as 0044's pending_week_review, applied to the repertoire seed instead
-- of the check-in: the chat wire is pure SSE prose, so a tool call never reaches the browser, and
-- this small pointer is how the client learns an offer is up. It polls, renders the offer, and
-- opening the review is a separate step from this migration.
--
-- The pointer carries an OFFER and never a result. `{collection, where_you_are, goal_id,
-- offered_at}` is everything the review screen needs to open pre-marked; no piece, no standing and
-- no count is stored here, because nothing is on the person's file until they confirm on that
-- screen (POST /progress/repertoire/seed/confirm is the only writer, as it already was for the
-- user's own door). A pointer that carried the pieces would be a record of a decision nobody made.
--
-- Purely additive.
alter table cadence.users
  add column if not exists pending_repertoire_review jsonb;
