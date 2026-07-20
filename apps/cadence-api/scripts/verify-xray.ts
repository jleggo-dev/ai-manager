/**
 * Verify the dev X-ray trace is recorded when the pipeline runs (context + broker), and that
 * the persona fetch (for the panel) works. Coach/capture recording happens in the HTTP route
 * on real turns and uses the same updateTrace mechanism.
 * Run: node --import tsx apps/cadence-api/scripts/verify-xray.ts
 */
import { buildContextPack } from '../src/services/context-pack.ts';
import { getTrace } from '../src/services/dev-trace.ts';
import { getCoachPersona } from '../src/ai/aim.ts';
import { insertGoal } from '../src/repos/goals.ts';
import { mergeBaseline } from '../src/repos/users.ts';
import { sql } from '../src/db/sql.ts';

const DEV = '00000000-0000-4000-a000-000000000001';

async function clean() {
  await sql`delete from cadence.goals where user_id = ${DEV}`;
  await sql`delete from cadence.context_pack where user_id = ${DEV}`;
  await sql`update cadence.users set baseline = '{}'::jsonb where id = ${DEV}`;
}

async function main() {
  let ok = true;
  try {
    await clean();
    await insertGoal(DEV, { title: 'Spartan Beast in October', category: 'fitness', type: 'milestone' } as never);
    await mergeBaseline(DEV, {
      injuries: [{ area: 'left knee', condition: 'patellar tendinopathy', plan_around: true }],
    } as never);

    await buildContextPack(DEV, 'onboarding');
    const t = getTrace(DEV);
    const persona = await getCoachPersona(DEV);

    console.log('trace.context.mode :', t?.context?.mode);
    console.log('trace.provenance   :', t?.context?.provenance?.map((p) => `${p.fn}(${p.rows})`).join(', '));
    console.log('trace.scribeSelect :', t?.scribeSelect?.reason ?? '(fallback)');
    console.log('trace.scribeSumm   :', (t?.scribeSummarize?.output || '(fallback)').slice(0, 70).replace(/\n/g, ' '));
    console.log('trace.data keys    :', Object.keys(t?.context?.data ?? {}).join(', '));
    console.log('persona first line :', (persona || '(none)').split('\n')[0]);

    const check = (l: string, c: boolean) => {
      console.log(`${c ? '✓' : '✗'} ${l}`);
      if (!c) ok = false;
    };
    check('context recorded', !!t?.context);
    check('provenance has fns', (t?.context?.provenance?.length ?? 0) > 0);
    check('data captured', Object.keys(t?.context?.data ?? {}).length > 0);
    check('persona fetched for panel', !!persona && persona.includes('You are Cadence'));
    console.log(ok ? '\nXRAY TRACE OK' : '\nXRAY TRACE INCOMPLETE');
  } finally {
    await clean();
    await sql`delete from cadence.conversations where user_id = ${DEV}`;
    await sql.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
