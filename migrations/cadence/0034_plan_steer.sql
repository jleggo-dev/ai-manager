-- 0034: the plan remembers what the USER asked for, in their own words.
--
-- "Custom — let's talk" takes a sentence ("you're being overly protective of my elbow, I'm good
-- for dead hangs"), feeds it to synthesis, and throws it away. So the week changes and nothing
-- anywhere records WHY — the coach in general chat sees a different plan with no idea the person
-- asked for it, and asks about the elbow again next week (owner, 2026-08-15: "If it did work,
-- Coach general chat should know about this change to the plan").
--
-- Stored on the plan VERSION, not the user, because it is the reason that version exists: v3's
-- steer stays attached to v3 forever, and superseding it doesn't erase the history of asks.
-- Nullable — most versions have no steer (the automated weekly re-plan, the first lock), and
-- inventing one would be invention.
--
-- NOT a substitute for a constraint change. "I'm good for dead hangs" is also a fact about their
-- elbow, and belongs in constraints via the coach's own correction path; this column records the
-- ASK, which is a different thing and outlives the plan it produced.
alter table cadence.plans
  add column if not exists steer text;
