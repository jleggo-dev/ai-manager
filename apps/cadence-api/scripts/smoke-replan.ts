/**
 * Phase 3 smoke: fresh lock (refactored spine) → v1, check off today, adaptive re-plan → v2.
 * Verifies versioning (v1 superseded, v2 active), a coach note, and occurrence hygiene (no orphan
 * future-pending occurrences from the superseded plan). Uses account-1 via HTTP; DB checks via sql.
 * Run: node --import tsx apps/cadence-api/scripts/smoke-replan.ts
 */
import { sql } from '../src/db/sql.ts';
import { devAccount } from './dev-account.ts';

const BASE = 'http://localhost:3101';
const H = { 'Content-Type': 'application/json', 'X-Cadence-Dev-User': 'account-1' };
const U = devAccount('account-1');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (l: string, c: boolean) => console.log(`${c ? '✓' : '✗'} ${l}`);
const jget = async (p: string) => (await fetch(`${BASE}${p}`, { headers: H })).json();
const jpost = async (p: string, body?: unknown) => (await fetch(`${BASE}${p}`, { method: 'POST', headers: H, body: body ? JSON.stringify(body) : undefined })).json();

async function main() {
  for (let i = 0; i < 25; i++) { try { if ((await fetch(`${BASE}/plan`, { headers: H })).ok) break; } catch {} await sleep(1000); }
  await jpost('/dev/reset');

  // 1. Fresh lock → v1 (exercises the refactored synthesize→vet→commit spine)
  await jpost('/review/goals', { title: 'Run a 10k', area: 'movement', type: 'target' });
  await jpost('/review/goals', { title: 'Journal daily', area: 'practice', type: 'recurring' });
  await jpost('/review/confirm');
  let t = Date.now();
  const lock = await jpost('/plan/lock');
  console.log(`lock: ${lock.status} · ${lock.activities} activities · ${((Date.now() - t) / 1000).toFixed(0)}s`);
  ok('fresh lock committed (refactored spine works)', lock.status === 'committed');

  const v1 = await jget('/plan');
  console.log(`v1 activities: ${v1.activities.map((a: { title: string; cadence: string }) => a.title + ' [' + a.cadence + ']').join(', ')}`);

  // 2. Show up: check off today's occurrences
  const today = v1.week.find((d: { isToday: boolean }) => d.isToday);
  for (const o of today.occurrences) await jpost(`/plan/occurrences/${o.occurrence_id}`, { status: 'done' });
  console.log(`checked off ${today.occurrences.length} today`);

  // 3. Adaptive re-plan → v2
  t = Date.now();
  const rp = await jpost('/plan/replan');
  console.log(`\nreplan: ${rp.status} · version=${rp.version} · ${rp.activities} activities · ${((Date.now() - t) / 1000).toFixed(0)}s`);
  console.log(`coach note: "${rp.note}"`);
  ok('replan committed', rp.status === 'committed');
  ok('version incremented to 2', rp.version === 2);
  ok('replan returned a coach note', typeof rp.note === 'string' && rp.note.length > 0);

  const v2 = await jget('/plan');
  console.log(`v2 activities: ${v2.activities.map((a: { title: string; cadence: string }) => a.title + ' [' + a.cadence + ']').join(', ')}`);
  ok('plan view now shows v2', v2.version === 2);

  // 4. DB integrity: one active (v2), one superseded (v1); no orphan future-pending occurrences
  const plans = await sql<{ version: number; status: string }[]>`select version, status from cadence.plans where user_id = ${U} order by version`;
  console.log('plans:', plans.map((p) => `v${p.version}:${p.status}`).join(', '));
  ok('v1 superseded, v2 active', plans.length === 2 && plans[0]?.status === 'superseded' && plans[1]?.status === 'active');

  const [orphan] = await sql<{ n: number }[]>`
    select count(*)::int n from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    join cadence.plans p on p.plan_id = a.plan_id
    where o.user_id = ${U} and p.status = 'superseded' and o.date >= ${new Date().toISOString().slice(0, 10)} and o.status = 'pending'`;
  ok('no orphan future-pending occurrences from the superseded plan', orphan!.n === 0);

  const [kept] = await sql<{ n: number }[]>`
    select count(*)::int n from cadence.occurrences where user_id = ${U} and status = 'done'`;
  ok('history preserved (done occurrences still exist across versions)', kept!.n >= 1);

  await jpost('/dev/reset');
  console.log('\ncleaned up account-1');
  await sql.end();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
