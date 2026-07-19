/**
 * Live end-to-end: the spec's first vertical slice against real models + real DB.
 *   1. Build the dossier-grounded Coach system prompt (stateless-LLM design, §4.3).
 *   2. Open a Coach session + stream one turn (Sonnet 4.5 via Devs.ai).
 *   3. Run capture_extract (Gemini Flash) on an onboarding message → persist to the DB.
 *   4. Read the captured records back, then clean up the dev user's data.
 * Run: node --import tsx apps/cadence-api/scripts/live-coach.ts
 */
import { buildContextPack } from '../src/services/context-pack.ts';
import { openCoachSession, injectCoachContext, sendCoachMessage } from '../src/ai/aim.ts';
import { runCaptureExtract } from '../src/services/capture.ts';
import { listGoals } from '../src/repos/goals.ts';
import { listEquipment } from '../src/repos/equipment.ts';
import { getUser } from '../src/repos/users.ts';
import { sql } from '../src/db/sql.ts';

const DEV = '00000000-0000-4000-a000-000000000001';

function parseSse(buf: string): string {
  let content = '';
  for (const line of buf.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') continue;
    try {
      const p = JSON.parse(data);
      const delta = p.choices?.[0]?.delta?.content ?? p.text ?? p.delta ?? p.content ?? '';
      if (typeof delta === 'string') content += delta;
      if (p.type === 'formatted_response' && typeof p.content === 'string') content = p.content;
    } catch {
      /* keepalive */
    }
  }
  return content;
}

async function main() {
  try {
    // 1. Persona-only session (system prompt from the coach job) + injected context turn
    const context = (await buildContextPack(DEV, 'onboarding')).rendered;
    console.log('— context head:', context.slice(0, 160).replace(/\n/g, ' '), '…');

    // 2. Coach session + one streamed turn
    const session = await openCoachSession(DEV);
    await injectCoachContext(DEV, session.sessionId, context);
    console.log('✓ session opened:', session.sessionId);
    const { response } = await sendCoachMessage(
      DEV,
      session.sessionId,
      'Hi — I want to start running again. Reply in one short sentence.',
    );
    const reader = response.body!.getReader();
    const dec = new TextDecoder();
    let raw = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += dec.decode(value, { stream: true });
    }
    const reply = parseSse(raw);
    console.log('✓ coach reply:', reply.slice(0, 200) || `(unparsed; raw head: ${raw.slice(0, 120)})`);

    // 3. Capture from an onboarding message → persist
    const cap = await runCaptureExtract(DEV, {
      conversation_window:
        'I want to run a 10k in about 12 weeks. I have ASICS Gel-Nimbus shoes. My left knee has patellar tendinopathy, so go easy on it.',
    });
    console.log(
      '✓ capture_extract:',
      JSON.stringify({
        goals: cap.goals?.length ?? 0,
        equipment: cap.equipment?.length ?? 0,
        confidence: cap.confidence,
        persisted: cap.persisted,
      }),
    );

    // 4. Read back
    const goals = await listGoals(DEV);
    const equip = await listEquipment(DEV);
    const user = await getUser(DEV);
    console.log('✓ goals in DB:    ', goals.map((g) => `${g.title} [${g.category}/${g.type}]`).join(' | ') || '(none)');
    console.log('✓ equipment in DB:', equip.map((e) => e.name).join(' | ') || '(none)');
    console.log('✓ baseline:       ', JSON.stringify(user?.baseline ?? {}));

    console.log('\nLIVE COACH PASS');
  } finally {
    await sql`delete from cadence.goals where user_id = ${DEV}`;
    await sql`delete from cadence.equipment where user_id = ${DEV}`;
    await sql`delete from cadence.conversations where user_id = ${DEV}`;
    await sql`update cadence.users set baseline = '{}'::jsonb where id = ${DEV}`;
    await sql.end();
    console.log('cleaned up dev-user data');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('LIVE FAIL:', e);
    process.exit(1);
  });
