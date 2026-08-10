-- 0029 — remember which upstream response is in flight, so Stop can actually stop it.
-- Additive and idempotent; safe to re-run.
--
-- Pressing Stop used to end only the CLIENT's listening. The reply ran to completion upstream,
-- was billed in full, and reappeared whole the next time the conversation was restored — the
-- opposite of what the button says.
--
-- Cancelling it needs the Devs.ai v2 response id of the turn currently generating. AI Admin's own
-- HTTP chat route stashes that in the chat session's provider_metadata as it streams, but Cadence
-- consumes the stream IN-PROCESS and never goes through that route, so for a coach turn the
-- metadata is either empty or — worse — still holds the PREVIOUS turn's id.
--
-- So the coach relay records it here the moment the stream announces it, and clears it when the
-- turn ends. Deliberately NOT provider_metadata.previous_response_id: writing that column would
-- switch Cadence's turns to upstream response-chaining, a real change to how every prompt is
-- built, smuggled in behind a Stop button.
--
-- Null is the normal resting state and means "nothing generating right now". A stale non-null
-- value (process died mid-turn) is harmless: cancelling an already-finished response is a no-op
-- upstream, and the next turn overwrites it.
alter table cadence.conversations
  add column if not exists in_flight_response_id text;

comment on column cadence.conversations.in_flight_response_id is
  'Devs.ai v2 response id of the turn currently generating; null when idle. Written by the coach SSE relay, read by POST /coach/sessions/:id/stop.';
