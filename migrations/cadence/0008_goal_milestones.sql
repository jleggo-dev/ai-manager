-- 0008 — Goal stepping-stones. A big goal (a Spartan Beast in October) can carry an ordered list
-- of intermediate checkpoints the coach proposes when pressure-testing realism (e.g. "run a
-- continuous 10k by August"). Purely additive; each milestone: { id, label, target_date?, done? }.
alter table cadence.goals
  add column if not exists milestones jsonb not null default '[]'::jsonb;
