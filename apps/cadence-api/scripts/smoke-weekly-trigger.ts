/**
 * Phase 3d smoke: the automatic weekly re-plan trigger (services/situation.ts). Fabricates a
 * real consistency dip in the DB (can't wait 7 real days), then drives the whole loop over HTTP:
 * GET /plan kicks off the background weekly gate -> tripwire fires -> situation_assess (Broker)
 * recommends a re-plan -> a pending proposal is stored and served -> dismiss clears it -> the
 * gate itself throttles (no proposal reappears without re-arming it) -> re-arm + re-fire ->
 * accept runs the real re-plan (version increments, proposal clears).
 * Run: node --import tsx apps/cadence-api/scripts/smoke-weekly-trigger.ts
 */
import { sql } from '../src/db/sql.ts';
import { devAccount } from './dev-account.ts';

const BASE = 'http://localhost:3101';
const H = { 'Content-Type': 'application/json', 'X-Cadence-Dev-User': 'account-1' };
const U = devAccount('account-1');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (l: string, c: boolean) => console.log(`${c ? '✓' : '✗'} ${l}`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const jget = async (p: string) => (await fetch(`${BASE}${p}`, { headers: H })).json();
const jpost = async (p: string, body?: unknown) =>
  (await fetch(`${BASE}${p}`, { method: 'POST', headers: H, body: body ? JSON.stringify(body) : undefined })).json();

/**
 * ensureHorizon only ever materializes FORWARD from today, so past dates have no occurrence rows
 * to update — insert synthetic 'done' rows directly against one of the plan's real activities,
 * exactly like a real user's completion history would look to a fresh read of the table.
 */
async function insertDoneRange(from: Date, to: Date) {
  const [activity] = await sql<{ activity_id: string }[]>`
    select a.activity_id from cadence.activities a
    join cadence.plans p on p.plan_id = a.plan_id
    where p.user_id = ${U} and p.status = 'active' limit 1`;
  if (!activity) throw new Error('no active-plan activity to attach fabricated history to');
  for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) {
    await sql`
      insert into cadence.occurrences (activity_id, user_id, date, status)
      values (${activity.activity_id}, ${U}, ${iso(new Date(t))}, 'done')
      on conflict (activity_id, date) do update set status = 'done'`;
  }
}

async function pollForProposal(maxTries = 20): Promise<{ pendingProposal: { reason: string; suggested_levers: string[] } | null }> {
  for (let i = 0; i < maxTries; i++) {
    const v = await jget('/plan');
    if (v.pendingProposal) return v;
    await sleep(1000);
  }
  return jget('/plan');
}

async function main() {
  for (let i = 0; i < 25; i++) {
    try {
      if ((await fetch(`${BASE}/plan`, { headers: H })).ok) break;
    } catch {
      /* retry */
    }
    await sleep(1000);
  }
  await jpost('/dev/reset');

  // 1. Fresh lock -> v1 (2-week horizon materializes, all occurrences 'pending' by default).
  await jpost('/review/goals', { title: 'Run a 10k', area: 'movement', type: 'target' });
  await jpost('/review/goals', { title: 'Journal daily', area: 'practice', type: 'recurring' });
  await jpost('/review/confirm');
  const lock = await jpost('/plan/lock');
  ok('fresh lock committed', lock.status === 'committed');

  // 2. Fabricate a real week-over-week consistency dip: showed up most of days -13..-7, nothing
  //    days -6..0. This is exactly what buildSnapshot() in services/situation.ts reads from the DB.
  const now = new Date();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  await insertDoneRange(new Date(base - 13 * 86_400_000), new Date(base - 7 * 86_400_000));
  console.log('fabricated: done days -13..-7, pending days -6..0 (a real consistency drop)');

  // 3. GET /plan kicks off the background weekly gate (last_assessed_at is null after reset, so
  //    it's due). Poll until the Broker-recommended proposal lands.
  const v1 = await pollForProposal();
  ok('tripwire fired -> situation_assess recommended a proposal', !!v1.pendingProposal);
  if (v1.pendingProposal) {
    console.log(`proposal reason: "${v1.pendingProposal.reason}"`);
    console.log(`suggested levers: ${JSON.stringify(v1.pendingProposal.suggested_levers)}`);
  }
  ok('proposal has a non-empty reason', !!v1.pendingProposal?.reason && v1.pendingProposal.reason.length > 0);

  // 4. Dismiss clears it.
  await jpost('/plan/proposal/dismiss');
  const afterDismiss = await jget('/plan');
  ok('dismiss clears the proposal', afterDismiss.pendingProposal === null);

  // 5. The weekly gate throttles: last_assessed_at was just touched, so calling GET /plan again
  //    must NOT immediately re-fire even though the fabricated dip is still sitting in the DB.
  await sleep(2000); // give any (incorrect) background re-assessment a chance to land
  const throttled = await jget('/plan');
  ok('weekly gate throttles a second assessment (no proposal reappears)', throttled.pendingProposal === null);

  // 6. Re-arm the gate (simulate "a week has passed") and fire again for the accept path.
  await sql`update cadence.users set last_assessed_at = null where id = ${U}`;
  const v2 = await pollForProposal();
  ok('re-armed gate fires again', !!v2.pendingProposal);

  // 7. Accept runs the real re-plan spine: version increments, proposal clears.
  const before = await jget('/plan');
  const accept = await jpost('/plan/proposal/accept');
  console.log(`accept: ${accept.status} · version=${accept.version} · note="${accept.note}"`);
  ok('accept committed', accept.status === 'committed');
  ok('version incremented', accept.version === (before.version ?? 1) + 1);
  const afterAccept = await jget('/plan');
  ok('proposal cleared after accept', afterAccept.pendingProposal === null);

  await jpost('/dev/reset');
  console.log('\ncleaned up account-1');
  await sql.end();
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
