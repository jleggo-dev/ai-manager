/**
 * P1 verification: the DB + repos accept the new enum values (goal.status 'committed',
 * equipment.category practice/craft/study) and reject the retired ones. Uses account-2,
 * cleans up after itself.
 * Run: node --import tsx apps/cadence-api/scripts/verify-p1.ts
 */
import { sql } from '../src/db/sql.ts';
import { insertGoal } from '../src/repos/goals.ts';
import { insertEquipment } from '../src/repos/equipment.ts';
import { ensureUser, resetUserData } from '../src/services/dev-reset.ts';
import { devAccount } from './dev-account.ts';

const U = devAccount('account-2');

async function main() {
  await resetUserData(U);
  const ok = (l: string, c: boolean) => console.log(`${c ? '✓' : '✗'} ${l}`);

  // committed status accepted
  const g = await insertGoal(U, { title: 'test', area: 'practice', type: 'recurring', status: 'committed' });
  const [row] = await sql<{ status: string }[]>`select status from cadence.goals where goal_id = ${g.goal_id}`;
  ok("goal.status 'committed' accepted + persisted", row?.status === 'committed');

  // new equipment categories accepted
  for (const cat of ['practice', 'craft', 'study'] as const) {
    const e = await insertEquipment(U, { name: `t-${cat}`, category: cat, owned: true });
    const [er] = await sql<{ category: string }[]>`select category from cadence.equipment where equipment_id = ${e.equipment_id}`;
    ok(`equipment.category '${cat}' accepted`, er?.category === cat);
  }

  // retired 'locked' rejected by CHECK
  let lockedRejected = false;
  try {
    await sql`insert into cadence.goals (user_id, title, area, type, status) values (${U}, 'x', 'movement', 'target', 'locked')`;
  } catch {
    lockedRejected = true;
  }
  ok("retired goal.status 'locked' rejected by CHECK", lockedRejected);

  // protect_momentum column exists (protect_streak gone)
  const cols = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema='cadence' and table_name='episodes' and column_name in ('protect_streak','protect_momentum')`;
  const names = cols.map((c) => c.column_name);
  ok('episodes.protect_momentum exists, protect_streak gone', names.includes('protect_momentum') && !names.includes('protect_streak'));

  await ensureUser(U);
  await resetUserData(U);
  console.log('cleaned up');
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
