/**
 * One-off read-only inspection for the 2026-08-17 run-schedule report: what tool calls did the
 * coach actually make, what did she say around them, and what does the plan actually hold?
 * Read-only — writes nothing, deletes nothing. Run: node --import tsx scripts/inspect-plan-move.ts <uuid>
 */
import { sql } from '../src/db/sql.ts';

const userId = process.argv[2];
if (!userId) throw new Error('user uuid required');

const logs = await sql<{ kind: string; input: unknown; output: unknown; meta: unknown; created_at: string }[]>`
  select kind, input, output, meta, created_at
    from cadence.ai_log
   where user_id = ${userId}
     and created_at > now() - interval '36 hours'
     and kind in ('coach_tool')
   order by created_at asc`;
console.log('── coach_tool log rows (36h) ──');
for (const r of logs) {
  console.log(`\n[${r.created_at}]`);
  console.log('input :', JSON.stringify(r.input)?.slice(0, 1500));
  console.log('output:', JSON.stringify(r.output)?.slice(0, 1200));
  console.log('meta  :', JSON.stringify(r.meta)?.slice(0, 400));
}

const plans = await sql<{ plan_id: string; status: string; version: number; created_at: string }[]>`
  select plan_id, status, version, created_at from cadence.plans
   where user_id = ${userId} order by created_at desc limit 3`;
console.log('\n── plans ──');
console.log(plans);

const active = plans.find((p) => p.status === 'committed' || p.status === 'active') ?? plans[0];
if (active) {
  const acts = await sql<{ title: string; schedule: unknown; kind: string }[]>`
    select title, schedule, kind from cadence.activities where plan_id = ${active.plan_id} order by title`;
  console.log(`\n── activities of plan ${active.plan_id} (${active.status} v${active.version}) ──`);
  for (const a of acts) console.log(`  ${a.title.padEnd(30)} ${JSON.stringify(a.schedule)}`);
}

const pending = await sql<{ pending_plan: unknown }[]>`
  select baseline -> 'x' as ignore, pending_plan from cadence.users where id = ${userId}`;
console.log('\n── pending_plan ──');
console.log(JSON.stringify(pending[0]?.pending_plan, null, 2)?.slice(0, 3000));

await sql.end();
