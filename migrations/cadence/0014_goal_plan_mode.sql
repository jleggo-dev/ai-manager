-- 0014 — per-goal plan mode.
--   'coach' (default): the Coach programs each fitness session on demand (today's behavior).
--   'deterministic': a progression engine (apps/cadence-api/src/services/progression.ts) computes
--     each session from the eval session + a scheme; the Coach only runs the eval + monthly rebuild.
-- Idempotent so it's safe to re-run.
alter table cadence.goals
  add column if not exists plan_mode text not null default 'coach';

alter table cadence.goals
  drop constraint if exists goals_plan_mode_check;
alter table cadence.goals
  add constraint goals_plan_mode_check check (plan_mode in ('coach', 'deterministic'));
