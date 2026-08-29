/**
 * Live repo smoke test: insert → read → (shoe-mileage) → cleanup against the
 * real `cadence` schema, as the seeded dev user, via direct Postgres.
 * Requires CADENCE_DATABASE_URL in apps/cadence-api/.env. No AI Admin needed.
 * Run: node --import tsx apps/cadence-api/scripts/smoke-repos.ts
 */
import { insertGoal, listGoals } from '../src/repos/goals.ts';
import { insertEquipment, listEquipment, getActiveFootwear, updateWear } from '../src/repos/equipment.ts';
import { applyRun } from '../src/services/shoe-mileage.ts';
import { createConversation } from '../src/repos/conversations.ts';
import { sql } from '../src/db/sql.ts';

const DEV = '00000000-0000-4000-a000-000000000001';

async function main() {
  const created: { goal?: string; equip?: string; convo?: string } = {};
  try {
    const goal = await insertGoal(DEV, {
      title: 'SMOKE 10k',
      area: 'movement',
      type: 'milestone',
      measure: { metric: 'distance', target: 10, unit: 'km', direction: 'increase' },
      timeframe: { start: '2026-06-29' },
      confidence: 0.9,
    });
    created.goal = goal.goal_id;
    console.log('✓ insertGoal           ', goal.goal_id, 'status=' + goal.status);

    const shoe = await insertEquipment(DEV, {
      name: 'SMOKE ASICS',
      category: 'footwear',
      owned: true,
      wear: {
        tracks_mileage: true,
        accumulated_km: 412,
        threshold_km: 600,
        auto_sum_from: 'healthkit_runs',
        status: 'active',
      },
    });
    created.equip = shoe.equipment_id;
    console.log('✓ insertEquipment      ', shoe.equipment_id);

    const active = await getActiveFootwear(DEV);
    console.log(
      '✓ getActiveFootwear    ',
      active?.equipment_id === shoe.equipment_id ? 'matches' : 'MISMATCH',
      'km=' + active?.wear?.accumulated_km,
    );

    // Shoe mileage action (was services/completion.addRunMileage — removed as unwired;
    // wire into logOccurrence when run distance is available on the completion path).
    const shoeWear = active?.wear?.tracks_mileage ? applyRun(active.wear, 5.2) : null;
    if (shoeWear && active) await updateWear(DEV, active.equipment_id, shoeWear);
    console.log(
      '✓ applyRun(5.2)+updateWear',
      'km=' + shoeWear?.accumulated_km,
      'status=' + shoeWear?.status,
      shoeWear?.accumulated_km === 417.2 ? '(expected 417.2 ✓)' : '(UNEXPECTED)',
    );

    const convo = await createConversation(DEV, 'smoke-session-' + Date.now(), null);
    created.convo = convo.conversation_id;
    console.log('✓ createConversation   ', convo.conversation_id);

    console.log(
      '✓ lists                 goals=' +
        (await listGoals(DEV)).length +
        ' equipment=' +
        (await listEquipment(DEV)).length,
    );

    console.log('\nSMOKE PASS');
  } finally {
    if (created.goal) await sql`delete from cadence.goals where goal_id = ${created.goal}`;
    if (created.equip) await sql`delete from cadence.equipment where equipment_id = ${created.equip}`;
    if (created.convo)
      await sql`delete from cadence.conversations where conversation_id = ${created.convo}`;
    await sql.end();
    console.log('cleaned up:', created);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('SMOKE FAIL:', e);
    process.exit(1);
  });
