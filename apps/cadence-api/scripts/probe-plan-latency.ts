/**
 * OPERATOR PROBE: assert the plan-change latency budgets against live runs.
 *
 * PLAN-CHANGES.md's acceptance table gives every plan-change scenario a budget; this probe runs
 * the READ-ONLY scenarios end to end against a real user's active plan and holds each to its
 * number, one verdict line per scenario, non-zero exit on any bust. It reuses
 * probe-evolve-plan.ts's approach: `planEvolve` writes nothing but ai_log observability rows
 * (no pending_plan, no push), so probing the owner's live account changes nothing they can see.
 *
 * NOT wired into CI, deliberately: every run makes real model calls on a live relay — paid, and
 * with minutes of variance the relay owns, not us (the same-shaped run that took 56s one time and
 * 242s the next). In CI that is a flaky, billable test; as an operator tool it is the answer to
 * "did the budgets survive this change" — run it after touching the evolve path, the evolve-plan
 * job prompt, or the aim transport, and before/after a model move.
 *
 * Spend per full run: one evolve-plan call per scenario (2 by default) — unless a scenario falls
 * back, in which case the fallback's full synthesis (fan-out + reduce + vet) runs too, exactly as
 * it would for a user. The verdict line says when that happened.
 *
 * Run:  node --import tsx apps/cadence-api/scripts/probe-plan-latency.ts
 *       SCENARIOS=small_steer node --import tsx apps/cadence-api/scripts/probe-plan-latency.ts
 *       SMALL_STEER="..." REBALANCE_STEER="..." USER_ID=... node --import tsx apps/cadence-api/scripts/probe-plan-latency.ts
 */
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv({ path: path.join(root, 'apps/cadence-api/.env') });
dotenv({ path: path.join(root, 'backend/.env') });

const { sql } = await import('../src/db/sql.ts');
const { gatherReplanInputs } = await import('../src/services/replan.ts');
const { planEvolve } = await import('../src/services/plan-evolve.ts');

/**
 * The budgets under assertion, in seconds — the acceptance table in docs/cadence/PLAN-CHANGES.md
 * ("Latency budgets" / "Measuring") is the source of truth; change it there first, then here.
 *
 * rebalance_steer is asserted at the owed 120s: the cadence-evolve profile (primary
 * anthropic-claude-4-5-sonnet, owner ruling 2026-09-01) closed the deliberation gap — measured
 * 66-112s on this steer across the benchmark rounds. Relay variance is real, so a bust here is
 * worth a second run before it's called a regression.
 */
const BUDGETS_S = {
  small_steer: 60,
  rebalance_steer: 120,
} as const;

interface Scenario {
  name: keyof typeof BUDGETS_S;
  steer: string;
}

/** The two steers are the Phase-1 measurement's own (2026-09-01, the owner's real 4-goal plan):
 *  the incident ask, and a whole-week rebalance in the owner's register. Override via env to
 *  probe a different ask against the same budgets. */
const SCENARIOS: Scenario[] = [
  {
    name: 'small_steer',
    steer: process.env.SMALL_STEER ?? 'Add some chest and abs work to the strength session',
  },
  {
    name: 'rebalance_steer',
    steer:
      process.env.REBALANCE_STEER ??
      'Monday and Tuesday feel too light and everything is stacked late in the week - spread real ' +
        'strength and cardio work earlier across the week and clear the Wednesday pile-up.',
  },
];

const only = (process.env.SCENARIOS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function resolveUserId(): Promise<string> {
  // USER_ID wins; USER_EMAIL only works for rows that store one (the owner's doesn't — their
  // identity lives in Supabase auth, not cadence.users.email). Same handling as probe-evolve-plan.
  const fromEnv = process.env.USER_ID ?? '';
  if (fromEnv) return fromEnv;
  const email = process.env.USER_EMAIL ?? '';
  const [row] = email ? await sql<{ id: string }[]>`select id from cadence.users where email = ${email} limit 1` : [];
  if (!row) {
    console.error('set USER_ID (or USER_EMAIL for a row that stores one)');
    process.exit(1);
  }
  return row.id;
}

interface Verdict {
  name: string;
  pass: boolean;
  line: string;
}

/** The freshest evolve_plan exit row since t0 — planEvolve's result doesn't say which path ran,
 *  but its own ai_log exit row does (path / fell_back / edits_applied). The exit write is
 *  fire-and-forget inside planEvolve, so an immediate read can lose the race (first live run:
 *  small_steer printed `path=?`); poll briefly before giving up. */
async function exitRowSince(userId: string, t0: number): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
    const rows = await sql<{ meta: Record<string, unknown> }[]>`
      select meta from cadence.ai_log
      where user_id = ${userId} and kind = 'evolve_plan' and meta ? 'ms'
        and created_at > ${new Date(t0).toISOString()}
      order by created_at desc limit 1`;
    if (rows[0]) return rows[0].meta;
  }
  return {};
}

async function runScenario(userId: string, scenario: Scenario): Promise<Verdict> {
  const budgetS = BUDGETS_S[scenario.name];
  const inputs = await gatherReplanInputs(userId);
  if (!inputs || !inputs.currentPlan.length) {
    return { name: scenario.name, pass: false, line: 'BUST — no committed goals or no active plan to evolve' };
  }

  console.log(`\n── ${scenario.name} (budget ${budgetS}s) ──`);
  console.log(`   steer: ${scenario.steer}`);
  const t0 = Date.now();
  try {
    const r = await planEvolve(userId, { ...inputs, userSteer: scenario.steer });
    const wallS = (Date.now() - t0) / 1000;
    const meta = await exitRowSince(userId, t0);
    const detail = `path=${meta.path ?? '?'} fell_back=${meta.fell_back ?? '?'} edits_applied=${meta.edits_applied ?? '?'}`;
    // A vetoed/empty result within budget is still a bust: the scenario's job is to put a
    // proposal up, and the budget counts only when the change actually arrives.
    const pass = wallS < budgetS && r.status === 'proposed';
    return {
      name: scenario.name,
      pass,
      line: `${wallS.toFixed(1)}s (budget ${budgetS}s) · status=${r.status} · ${detail}`,
    };
  } catch (e) {
    const wallS = (Date.now() - t0) / 1000;
    return { name: scenario.name, pass: false, line: `threw after ${wallS.toFixed(1)}s — ${String(e).slice(0, 200)}` };
  }
}

const userId = await resolveUserId();
const inputs = await gatherReplanInputs(userId);
console.log(
  `user ${userId} · goals ${inputs?.goals.length ?? 0} · current plan ${inputs?.currentPlan.length ?? 0} activities`,
);

const toRun = SCENARIOS.filter((s) => only.length === 0 || only.includes(s.name));
if (toRun.length === 0) {
  console.error(`SCENARIOS matched nothing — known: ${SCENARIOS.map((s) => s.name).join(', ')}`);
  process.exit(1);
}

const verdicts: Verdict[] = [];
for (const scenario of toRun) verdicts.push(await runScenario(userId, scenario));

console.log('\n── VERDICT ──');
for (const v of verdicts) console.log(`  ${v.pass ? 'PASS' : 'BUST'}  ${v.name.padEnd(16)} ${v.line}`);
console.log(
  `  spent: ${toRun.length} live evolve run(s)${verdicts.some((v) => /fell_back=true/.test(v.line)) ? ' + fallback synthesis' : ''}`,
);

process.exitCode = verdicts.every((v) => v.pass) ? 0 : 1;
await sql.end();
