-- 0057 — the questionnaire pointer: cadence.users gains pending_questionnaire (the short set of
-- questions the coach's `send_questionnaire` tool last put on the person's screen). Same shape and
-- same reason as 0044's pending_week_review and 0055's pending_repertoire_review: the chat wire is
-- pure SSE prose, so a tool call never reaches the browser, and this small pointer is how the
-- client learns a card is up. It polls, renders the questions, and clears the pointer when the
-- person answers.
--
-- It holds the QUESTIONS and never the answers. `{questions:[{id,label,kind,options,hint}],
-- sent_at}` is everything the card needs to draw itself; the answers leave as an ordinary user
-- message in the person's own bubble (packages/cadence-shared/src/questionnaire.ts), because what
-- the coach receives has to be what the user can see they said. Storing them here as well would be
-- a second, invisible record of the same words — and one nobody would keep in step with the thread.
--
-- Purely additive.
alter table cadence.users
  add column if not exists pending_questionnaire jsonb;
