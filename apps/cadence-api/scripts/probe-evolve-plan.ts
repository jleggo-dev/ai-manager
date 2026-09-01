/**
 * LIVE PROBE: the diff-output evolve path (Phase 1, docs/cadence/PLAN-CHANGES.md).
 *
 * The claim under test: an adjustment expressed as EDITS (evolve-plan job → applyPlanEdits →
 * plan-vet) finishes in well under a minute, where the full-week re-emission it replaces measured
 * 242–563s in production. This runs `planEvolve` against a REAL user's active plan with a real
 * steer and prints where the time went and which path ran — and it is read-only on purpose:
 * planEvolve writes nothing but ai_log observability rows (no pending_plan, no push), so probing
 * the owner's live account changes nothing they can see.
 *
 * Run:  STEER="Add some chest and abs work to the strength session" \
 *         node --import tsx apps/cadence-api/scripts/probe-evolve-plan.ts
 *       USER_EMAIL=someone@example.com STEER="..." node --import tsx apps/cadence-api/scripts/probe-evolve-plan.ts
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

const steer = process.env.STEER ?? 'Add some chest and abs work to the strength session';

// USER_ID wins; USER_EMAIL is a convenience that only works for rows that store one (the owner's
// doesn't — their identity lives in Supabase auth, not cadence.users.email).
let userId = process.env.USER_ID ?? '';
if (!userId) {
  const email = process.env.USER_EMAIL ?? '';
  const [row] = email
    ? await sql<{ id: string }[]>`select id from cadence.users where email = ${email} limit 1`
    : [];
  if (!row) {
    console.error('set USER_ID (or USER_EMAIL for a row that stores one)');
    process.exit(1);
  }
  userId = row.id;
}
const user = { id: userId };

const inputs = await gatherReplanInputs(user.id);
if (!inputs || !inputs.currentPlan.length) {
  console.error('nothing to evolve — no committed goals or no active plan');
  process.exit(1);
}
console.log(`user ${user.id} · goals ${inputs.goals.length} · current plan ${inputs.currentPlan.length} activities`);
console.log(`steer: ${steer}\n`);

const t0 = Date.now();
const r = await planEvolve(user.id, { ...inputs, userSteer: steer });
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n=== ${r.status} in ${elapsed}s ===`);
if (r.status === 'proposed') {
  console.log(`activities in proposal: ${r.activities!.length}`);
  console.log(`note: ${r.note}`);
  console.log(`rationale: ${r.rationale}`);
  const changed = r.activities!.filter((a) => (a as { change_reason?: string }).change_reason);
  console.log(`rows carrying a change_reason: ${changed.length}`);
  for (const a of changed) {
    console.log(`  · ${a.title} — ${(a as { change_reason?: string }).change_reason}`);
  }
} else {
  console.log(JSON.stringify(r, null, 2));
}

// The measurement rows planEvolve just wrote — path, edits_applied, fell_back, ms.
const rows = await sql<{ meta: Record<string, unknown>; output: Record<string, unknown> }[]>`
  select meta, output from cadence.ai_log
  where user_id = ${user.id} and kind = 'evolve_plan' and created_at > now() - interval '10 minutes'
  order by created_at asc`;
console.log('\nai_log evolve_plan rows:');
for (const row of rows) console.log(' ', JSON.stringify({ ...row.meta, ...row.output }).slice(0, 300));

await sql.end();
