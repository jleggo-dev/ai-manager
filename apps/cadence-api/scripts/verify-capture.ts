/**
 * Verify capture quality after the fixes: full-conversation window + tightened prompt + dedup.
 * Expect FEW correct goals (not fragments), equipment captured, no invented numbers, and a
 * second identical run adds nothing (dedup). Also checks the durable ai_log.
 * Run: node --import tsx apps/cadence-api/scripts/verify-capture.ts
 */
import { runCaptureExtract } from '../src/services/capture.ts';
import { listGoalsByStatus } from '../src/repos/goals.ts';
import { listEquipment } from '../src/repos/equipment.ts';
import { getUser } from '../src/repos/users.ts';
import { sql } from '../src/db/sql.ts';

const DEV = '00000000-0000-4000-a000-000000000001';

// Mixed fitness + non-fitness conversation: the broadened brand promise in one window.
// Expect: a movement goal, a practice (or mind) goal, a physical constraint AND a life
// constraint, gym equipment AND a journal — nothing dropped.
const WINDOW = [
  "User: Hey, I'm Matt. I got out of shape this winter and I want to do a Spartan Beast at Blue Mountain in October, ideally under 5 hours.",
  'Coach: Love it, Matt. What do you have to work with?',
  'User: A squat rack, barbell, dumbbells, kettlebells, a pull-up bar, running shoes, and a journal.',
  'Coach: And how are you thinking about weight?',
  "User: I'm 48 and about 200 lbs right now — I'd like to get down to 180 lbs to move faster.",
  'Coach: Anything I should know to plan around?',
  "User: My left knee acts up — old patellar tendinopathy. And honestly I'm coming off some burnout at work, so I don't want anything punishing.",
  'Coach: Understood. Anything else you want to build in?',
  "User: Yeah — I've been trying to write morning pages every day. I want to keep that going.",
].join('\n');

async function clean() {
  await sql`delete from cadence.goals where user_id = ${DEV}`;
  await sql`delete from cadence.equipment where user_id = ${DEV}`;
  await sql`delete from cadence.ai_log where user_id = ${DEV}`;
  await sql`update cadence.users set baseline = '{}'::jsonb where id = ${DEV}`;
}

async function main() {
  try {
    await clean();

    const r1 = await runCaptureExtract(DEV, { conversation_window: WINDOW });
    const goals1 = await listGoalsByStatus(DEV, ['captured', 'confirmed', 'committed']);
    const equip1 = await listEquipment(DEV);
    console.log('=== after run 1 ===');
    console.log('persisted   :', JSON.stringify(r1.persisted));
    console.log('goals       :', goals1.map((g) => `${g.title} [${g.area}/${g.type}]`).join(' | '));
    console.log('equipment   :', equip1.map((e) => e.name).join(', ') || '(none)');
    const u1 = await getUser(DEV);
    console.log('name        :', u1?.name || '(none)');
    console.log('baseline    :', JSON.stringify(u1?.baseline ?? {}));
    console.log('goal measures:', goals1.map((g) => JSON.stringify(g.measure)).join(' | '));
    if ((r1 as { coerced?: string[] }).coerced) console.log('coerced     :', JSON.stringify((r1 as { coerced?: string[] }).coerced));

    const r2 = await runCaptureExtract(DEV, { conversation_window: WINDOW });
    const goals2 = await listGoalsByStatus(DEV, ['captured', 'confirmed', 'committed']);
    console.log('\n=== after run 2 (dedup check) ===');
    console.log('persisted   :', JSON.stringify(r2.persisted), '(expect 0 new)');
    console.log('total goals :', goals2.length);

    const logs = (await sql`select kind, created_at from cadence.ai_log where user_id = ${DEV} order by created_at`) as unknown as Array<{ kind: string }>;
    console.log('\nai_log rows :', logs.map((l) => l.kind).join(', '));

    console.log('\n--- checks ---');
    const ok = (l: string, c: boolean) => console.log(`${c ? '✓' : '✗'} ${l}`);
    const constraints = ((u1?.baseline as { constraints?: Array<{ label?: string; kind?: string; plan_around?: boolean }> })?.constraints ?? []);
    ok('few goals (<=3, not fragmented)', goals1.length <= 3 && goals1.length >= 1);
    ok('a movement goal captured', goals1.some((g) => g.area === 'movement'));
    ok('a NON-fitness goal captured (mind or practice)', goals1.some((g) => g.area === 'mind' || g.area === 'practice'));
    ok('captured multiple equipment incl. the journal', equip1.length >= 3 && equip1.some((e) => /journal/i.test(e.name)));
    ok('a physical constraint captured (knee)', constraints.some((c) => /knee/i.test(String(c.label))));
    ok('a LIFE constraint captured (burnout)', constraints.some((c) => /burnout/i.test(String(c.label))));
    ok('constraints carry plan_around flags', constraints.some((c) => c.plan_around === true));
    ok('stable across identical runs (no creep)', goals2.length === goals1.length);
    ok('name captured to users.name', !!u1?.name);
    ok('a goal has a numeric target (measure pre-fill)', goals1.some((g) => g.measure && (g.measure as { target?: unknown }).target != null));
    ok('capture logged to ai_log', logs.some((l) => l.kind === 'capture'));
  } finally {
    await clean();
    await sql.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
