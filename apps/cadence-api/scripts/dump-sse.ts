/**
 * Diagnostic: dump the shape of the Coach SSE events so we can fix the client parser.
 * Run: node --import tsx apps/cadence-api/scripts/dump-sse.ts
 */
import { openCoachSession, injectCoachContext, sendCoachMessage } from '../src/ai/aim.ts';
import { buildContextPack } from '../src/services/context-pack.ts';
import { sql } from '../src/db/sql.ts';

const DEV = '00000000-0000-4000-a000-000000000001';

async function main() {
  try {
    const ctx = (await buildContextPack(DEV, 'onboarding')).rendered;
    const s = await openCoachSession(DEV);
    await injectCoachContext(DEV, s.sessionId, ctx);
    const { response } = await sendCoachMessage(DEV, s.sessionId, 'I want to run a 10k. Reply in one sentence.');
    const reader = response.body!.getReader();
    const dec = new TextDecoder();
    let raw = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += dec.decode(value, { stream: true });
    }
    const events = raw.split('\n').filter((l) => l.startsWith('data: '));
    console.log(`total data: lines = ${events.length}`);
    for (const l of events.slice(0, 16)) {
      const d = l.slice(6).trim();
      if (d === '[DONE]') {
        console.log('[DONE]');
        continue;
      }
      try {
        const p = JSON.parse(d);
        console.log(
          JSON.stringify({
            keys: Object.keys(p),
            type: p.type,
            deltaContent: p.choices?.[0]?.delta?.content,
            content: typeof p.content === 'string' ? p.content.slice(0, 40) : p.content,
            text: p.text,
            delta: p.delta,
          }),
        );
      } catch {
        console.log('NON-JSON:', d.slice(0, 100));
      }
    }
  } finally {
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
