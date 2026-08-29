/**
 * Live rolling-horizon smoke: seed a plan with an every-other-day activity, materialize the
 * horizon, verify occurrences land on alternating dates, and that a second ensureHorizon call is
 * idempotent (no duplicate rows). Uses account-2, cleans up.
 * Run: node --import tsx apps/cadence-api/scripts/smoke-horizon.ts
 */
import { sql } from '../src/db/sql.ts';
import { insertPlan } from '../src/repos/plans.ts';
import { insertActivities } from '../src/repos/activities.ts';
import { ensureHorizon } from '../src/services/plan-horizon.ts';
import { resetUserData } from '../src/services/dev-reset.ts';
import { devAccount } from './dev-account.ts';

const U = devAccount('account-2');
const ok = (l: string, c: boolean) => console.log(`${c ? '✓' : '✗'} ${l}`);

async function countOcc(): Promise<number> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int n from cadence.occurrences where user_id = ${U}`;
  return r?.n ?? 0;
}

async function main() {
  await resetUserData(U);
  const plan = await insertPlan(U, { goal_ids: [], version: 1, status: 'active' });
  await insertActivities(U, plan.plan_id, [
    { title: 'Every other day ride', kind: 'user', schedule: { recurrence: 'FREQ=DAILY;INTERVAL=2' } },
    { title: 'Weekday journal', kind: 'user', schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' } },
  ] as never);

  const n1 = await ensureHorizon(U, 14);
  const today = new Date().toISOString().slice(0, 10);

  // Query ride dates as TEXT (postgres returns `date` columns as JS Date objects otherwise).
  const rideOnly = (await sql<{ d: string }[]>`
    select to_char(o.date, 'YYYY-MM-DD') as d from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${U} and a.title = 'Every other day ride' order by o.date`).map((r) => r.d);
  const gaps = rideOnly.slice(1).map(
    (d, i) => (Date.parse(d + 'T00:00:00Z') - Date.parse(rideOnly[i] + 'T00:00:00Z')) / 86_400_000,
  );
  console.log(`materialized ${n1} occurrences · ride dates: ${rideOnly.join(', ')}`);
  ok('ride recurs every 2 days (all gaps === 2)', gaps.length > 0 && gaps.every((g) => g === 2));
  ok('anchor = today (first ride is today)', rideOnly[0] === today);

  // idempotent top-up
  const before = await countOcc();
  await ensureHorizon(U, 14);
  const after = await countOcc();
  ok('second ensureHorizon is idempotent (no new rows)', before === after);

  // extend horizon → adds later dates, still no dupes for the overlap
  await ensureHorizon(U, 28);
  const extended = await countOcc();
  ok('extending horizon 14→28 adds later occurrences (more rows)', extended > after);

  await resetUserData(U);
  console.log('cleaned up account-2');
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
