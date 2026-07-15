/**
 * P2 verification — the Broker curates the context pack.
 * Seeds rich data, builds the pack for two intents (to show the Broker ADAPTS its function
 * selection), runs a grounded coach turn, asserts, and cleans up.
 * Run: node --import tsx apps/cadence-api/scripts/verify-p2.ts
 */
import { buildContextPack } from '../src/services/context-pack.ts';
import { openCoachSession, injectCoachContext, sendCoachMessage } from '../src/ai/aim.ts';
import { insertGoal } from '../src/repos/goals.ts';
import { insertEquipment } from '../src/repos/equipment.ts';
import { mergeBaseline } from '../src/repos/users.ts';
import { sql } from '../src/db/sql.ts';

const DEV = '00000000-0000-4000-a000-000000000001';

function streamToText(buf: string): string {
  let content = '';
  for (const line of buf.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const d = line.slice(6).trim();
    if (d === '[DONE]') continue;
    try {
      const p = JSON.parse(d);
      if (typeof p.choices?.[0]?.delta?.content === 'string') content += p.choices[0].delta.content;
    } catch {
      /* ignore */
    }
  }
  return content;
}

async function cleanup() {
  await sql`delete from cadence.goals where user_id = ${DEV}`;
  await sql`delete from cadence.equipment where user_id = ${DEV}`;
  await sql`delete from cadence.context_pack where user_id = ${DEV}`;
  await sql`delete from cadence.conversations where user_id = ${DEV}`;
  await sql`update cadence.users set baseline = '{}'::jsonb where id = ${DEV}`;
}

async function main() {
  let failures = 0;
  const check = (label: string, ok: boolean) => {
    console.log(`${ok ? '✓' : '✗'} ${label}`);
    if (!ok) failures++;
  };

  try {
    await cleanup(); // start clean

    // 1. Seed rich, realistic data.
    await insertGoal(DEV, { title: 'Finish a Spartan Beast at Blue Mountain in October', area: 'movement', type: 'milestone' } as never);
    await insertGoal(DEV, { title: 'Write morning pages daily', area: 'practice', type: 'recurring' } as never);
    await insertEquipment(DEV, { name: 'ASICS Gel-Nimbus', category: 'footwear', owned: true } as never);
    await mergeBaseline(DEV, {
      age: 38,
      weight_kg: { current: 92, start: 95 },
      constraints: [
        { id: 'c1', label: 'left knee — patellar tendinopathy', kind: 'physical', plan_around: true },
        { id: 'c2', label: 'burnout — keep the load gentle', kind: 'life', plan_around: true },
      ],
    } as never);
    console.log('seeded: 2 goals (movement + practice), 1 equipment, baseline (age/weight, knee + burnout constraints)\n');

    // 2. Build the pack for ONBOARDING (the Broker selects + summarizes).
    const onboard = await buildContextPack(DEV, 'onboarding');
    console.log('── ONBOARDING pack ──');
    console.log('mode      :', onboard.mode);
    console.log('why       :', onboard.selectReason);
    console.log('functions :', onboard.provenance.map((p) => `${p.fn}(${p.rows})`).join(', '));
    console.log('rendered  :\n' + onboard.rendered + '\n');

    // 3. Build for ONGOING — should select a DIFFERENT set (plan/adherence/weight).
    const ongoing = await buildContextPack(DEV, 'ongoing');
    console.log('── ONGOING pack ──');
    console.log('mode      :', ongoing.mode);
    console.log('why       :', ongoing.selectReason);
    console.log('functions :', ongoing.provenance.map((p) => p.fn).join(', '), '\n');

    // 4. A grounded coach turn using the onboarding pack.
    const s = await openCoachSession(DEV);
    await injectCoachContext(DEV, s.sessionId, onboard.rendered, { source: 'registry-pack', version: 1 });
    const { response } = await sendCoachMessage(DEV, s.sessionId, 'What should I focus on first?');
    const reader = response.body!.getReader();
    const dec = new TextDecoder();
    let raw = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += dec.decode(value, { stream: true });
    }
    const reply = streamToText(raw);
    console.log('── COACH REPLY ──\n' + reply + '\n');

    // 5. Assertions.
    const sum = onboard.rendered.toLowerCase();
    console.log('── CHECKS ──');
    check('onboarding pack is broker-curated', onboard.mode === 'broker-curated');
    check('ongoing pack is broker-curated', ongoing.mode === 'broker-curated');
    check('summary used the physical constraint (mentions knee)', sum.includes('knee'));
    check('summary used the life constraint (mentions burnout)', sum.includes('burnout'));
    check('summary used the goal (mentions spartan)', sum.includes('spartan'));
    check('select gave a reason', onboard.selectReason.length > 0 && onboard.selectReason !== '(deterministic selection)');
    check('constraints always retrieved (safety net)', onboard.provenance.some((p) => p.fn === 'get_constraints'));
    check('coach replied', reply.trim().length > 0);

    console.log(`\n${failures === 0 ? 'P2 PASS' : `P2 FAIL (${failures} check(s) failed)`}`);
  } finally {
    await cleanup();
    await sql.end();
    console.log('cleaned up dev-user data');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('P2 ERROR:', e);
    process.exit(1);
  });
