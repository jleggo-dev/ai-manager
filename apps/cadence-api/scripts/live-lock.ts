/**
 * Live lock flow (spec §C8.6): seed a confirmed goal + baseline + equipment, then
 * guardrail → synthesize_plan (Coach) → plan_vet (Broker) → commit plan + activities
 * + occurrences, and verify goals flipped to locked. Cleans up the dev user after.
 * Run: node --import tsx apps/cadence-api/scripts/live-lock.ts
 */
import { insertGoal, listGoalsByStatus } from '../src/repos/goals.ts';
import { insertEquipment } from '../src/repos/equipment.ts';
import { mergeBaseline } from '../src/repos/users.ts';
import { getActivePlan } from '../src/repos/plans.ts';
import { listActivities } from '../src/repos/activities.ts';
import { listOccurrences } from '../src/repos/occurrences.ts';
import { lockPlan } from '../src/services/lock.ts';
import { sql } from '../src/db/sql.ts';

const DEV = '00000000-0000-4000-a000-000000000001';

async function main() {
  try {
    // Seed a confirmed onboarding state
    await insertGoal(DEV, {
      title: 'Run a 10k',
      category: 'fitness',
      type: 'milestone',
      measure: { metric: 'distance', target: 10, unit: 'km', direction: 'increase' },
      timeframe: { start: '2026-06-29', end: '2026-09-20' },
      status: 'confirmed',
      confidence: 0.9,
    });
    await insertEquipment(DEV, {
      name: 'ASICS Gel-Nimbus',
      category: 'footwear',
      owned: true,
      wear: { tracks_mileage: true, accumulated_km: 0, threshold_km: 600, auto_sum_from: 'healthkit_runs', status: 'active' },
    });
    await mergeBaseline(DEV, {
      age: 41,
      injuries: [{ id: 'inj_knee_l', area: 'left_knee', condition: 'patellar tendinopathy', plan_around: true }],
      constraints: ['busy_mornings'],
      preferences: { nudge_tone: 'warm' },
    });
    console.log('✓ seeded: 1 confirmed goal, footwear, baseline (knee injury, plan_around)');

    // Lock
    const result = await lockPlan(DEV);
    console.log('✓ lockPlan:', JSON.stringify(result));

    // Verify
    const plan = await getActivePlan(DEV);
    const activities = plan ? await listActivities(plan.plan_id) : [];
    const today = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const occ = await listOccurrences(DEV, today, to);
    const locked = await listGoalsByStatus(DEV, ['locked']);
    console.log('✓ active plan:', plan?.plan_id, 'v' + plan?.version);
    console.log('✓ activities:', activities.map((a) => `[${a.kind}] ${a.title} — ${a.schedule?.recurrence ?? 'n/a'}`).join(' | '));
    console.log('✓ occurrences (14d):', occ.length);
    console.log('✓ goals now locked:', locked.map((g) => g.title).join(', ') || '(none)');

    console.log(result.status === 'locked' ? '\nLIVE LOCK PASS' : `\nLIVE LOCK: ${result.status}`);
  } finally {
    await sql`delete from cadence.occurrences where user_id = ${DEV}`;
    await sql`delete from cadence.activities where user_id = ${DEV}`;
    await sql`delete from cadence.plans where user_id = ${DEV}`;
    await sql`delete from cadence.goals where user_id = ${DEV}`;
    await sql`delete from cadence.equipment where user_id = ${DEV}`;
    await sql`update cadence.users set baseline = '{}'::jsonb where id = ${DEV}`;
    await sql.end();
    console.log('cleaned up dev-user data');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('LIVE LOCK FAIL:', e);
    process.exit(1);
  });
