-- 0030 — the few facts that make a goal a 50 km.
-- Additive and idempotent; safe to re-run.
--
-- A real user training for a 50 km Spartan Ultra Beast was handed a plan with one 45-minute flat
-- walk a week and no running at all. The synthesize-plan job's input for his goal was, in full:
--
--   {"title":"Complete the Spartan Ultra Beast in Quebec","type":"milestone",
--    "measure":{},"timeframe":{"end":"2027-06-01"},"milestones":[]}
--
-- Everything that decides how hard the training has to be — the 50 km, the mountain, the 30+
-- obstacles, having run the course before as a Beast, the 5–5½ hour finish times, a half marathon
-- last October — was said out loud and lived only in the chat transcript. The plan job never sees
-- the transcript. A title plus an empty measure is a label, not a goal, and no planner can size
-- work from a label.
--
-- So: one text column holding a few plain sentences of the load-determining facts in the user's
-- own words. Goals are already serialized whole into the plan job, so once it is written it rides
-- along everywhere the goal goes — no plumbing, no second fetch, nothing to keep in sync.
--
-- Deliberately TEXT and deliberately unstructured. The alternative was a schema for race
-- distance, terrain, obstacle count, previous finish time, prior results — a shape that fits
-- exactly one sport and quietly excludes the ordination exam, the novel, and the year of
-- sobriety that this app is equally for. The structured facts that generalize already have homes
-- (measure.target, measure.start, timeframe, milestones); this holds the rest.
--
-- Nullable, and null is the ordinary resting state: an older goal, a manually-added goal, or a
-- goal whose owner simply hasn't said much yet. Nothing may require it and nothing may invent it.
alter table cadence.goals
  add column if not exists brief text;

comment on column cadence.goals.brief is
  'A few plain sentences of the load-determining facts in the user''s own words (distance, terrain, what it demands, what they have done before). Broker-captured from the conversation; never inferred. Null is normal.';
