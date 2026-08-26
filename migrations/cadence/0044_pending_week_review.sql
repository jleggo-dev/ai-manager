-- 0044 — the Week review pointer: cadence.users gains pending_week_review (which plan week the
-- coach's `open_week_review` tool last put up on the user's screen, awaiting the user's tap-to-open
-- or dismiss) — same suggest-never-auto-apply shape as pending_plan, applied to the review surface
-- instead of a plan edit. The chat wire stays pure SSE prose (a tool call never reaches the
-- browser), so this small pointer is how the client learns a card is due: it polls, renders the
-- labelled card, and opening it is a separate step from this migration.
--
-- Purely additive.
alter table cadence.users
  add column if not exists pending_week_review jsonb;
