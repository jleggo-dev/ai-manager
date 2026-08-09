/**
 * Interactive onboarding simulator — drives the REAL coach pipeline turn-by-turn so we can
 * evaluate the conversation like a user would (repetition? one question at a time?).
 * Mirrors routes/coach.ts exactly: build pack → open session → inject context (start),
 * then per turn: sendCoachMessage → record the assistant reply (so history is complete) →
 * ambient capture. Session id persists in a scratch file across invocations.
 *
 *   node --import tsx apps/cadence-api/scripts/coach-sim.ts start
 *   node --import tsx apps/cadence-api/scripts/coach-sim.ts msg "…user message…"
 *   node --import tsx apps/cadence-api/scripts/coach-sim.ts end   (cleanup)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildContextPack } from '../src/services/context-pack.ts';
import { openCoachSession, injectCoachContext, sendCoachMessage, recordCoachReply } from '../src/ai/aim.ts';
import { renderCapabilities } from '../src/services/coach-capabilities.ts';
import { renderPickProtocol } from '../src/services/coach-picks-protocol.ts';
import { runCaptureExtract } from '../src/services/capture.ts';
import { sql } from '../src/db/sql.ts';

const DEV = '00000000-0000-4000-a000-000000000001';
// Was an absolute Windows path from the machine this was written on, so the script could not run
// anywhere else. The OS temp dir is the portable equivalent of what it was reaching for.
const SESSION_FILE = path.join(os.tmpdir(), 'cadence-coach-sim-session.txt');

async function clean() {
  await sql`delete from cadence.goals where user_id = ${DEV}`;
  await sql`delete from cadence.equipment where user_id = ${DEV}`;
  await sql`delete from cadence.context_pack where user_id = ${DEV}`;
  await sql`delete from cadence.conversations where user_id = ${DEV}`;
  await sql`update cadence.users set baseline = '{}'::jsonb, name = '' where id = ${DEV}`;
}

async function start() {
  await clean();
  const pack = await buildContextPack(DEV, 'onboarding');
  const s = await openCoachSession(DEV);
  await injectCoachContext(DEV, s.sessionId, pack.rendered, { source: 'registry-pack', version: 1 });
  // The route injects three blocks at session open, not one. The capability manifest and the
  // quick-pick protocol were missing here, which made this a mirror of a route that no longer
  // existed — and quietly meant the sim could never reproduce a pick set.
  await injectCoachContext(DEV, s.sessionId, renderCapabilities({}), { source: 'capabilities', version: 1 });
  await injectCoachContext(DEV, s.sessionId, renderPickProtocol({ intent: 'onboarding' }), {
    source: 'pick-protocol',
    version: 1,
  });
  fs.writeFileSync(SESSION_FILE, s.sessionId);
  console.log(`session started (${s.sessionId}) · pack ${pack.mode} · fns: ${pack.provenance.map((p) => p.fn).join(', ')}`);
  console.log('(the client opens with an <open> turn; the coach asks the first question)');
}

async function msg(text: string) {
  const sessionId = fs.readFileSync(SESSION_FILE, 'utf8').trim();
  const t0 = Date.now();
  const { response, diagnosticSession, resolvedMessage } = await sendCoachMessage(DEV, sessionId, text);
  const reader = response.body!.getReader();
  const dec = new TextDecoder();
  let raw = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    raw += dec.decode(value, { stream: true });
  }
  let content = '';
  let pt: number | null = null;
  let ct: number | null = null;
  let model: string | null = null;
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const d = line.slice(6).trim();
    if (d === '[DONE]') continue;
    try {
      const p = JSON.parse(d);
      if (typeof p.choices?.[0]?.delta?.content === 'string') content += p.choices[0].delta.content;
      if (p.usage) {
        pt = p.usage.prompt_tokens ?? pt;
        ct = p.usage.completion_tokens ?? ct;
      }
      if (typeof p.model === 'string' && !model) model = p.model;
    } catch {
      /* ignore */
    }
  }
  // Record the assistant turn so the next turn's history is complete (mirrors the route).
  await recordCoachReply(DEV, {
    sessionId,
    content,
    diag: diagnosticSession,
    metrics: { promptTokens: pt, completionTokens: ct, durationMs: Date.now() - t0, firstTokenMs: 1 },
    model,
    promptContent: resolvedMessage,
  });
  // Ambient capture (fire-and-forget in the route; awaited here to report progress).
  await runCaptureExtract(DEV, { conversation_window: text }).catch(() => null);
  const g = (await sql`select count(*)::int n from cadence.goals where user_id = ${DEV}`) as unknown as { n: number }[];
  const e = (await sql`select count(*)::int n from cadence.equipment where user_id = ${DEV}`) as unknown as { n: number }[];

  console.log(`\nUSER : ${text}`);
  console.log(`COACH: ${content}`);
  console.log(`       [captured so far: ${g[0]?.n ?? 0} goals, ${e[0]?.n ?? 0} equipment]`);
}

async function main() {
  const cmd = process.argv[2];
  try {
    if (cmd === 'start') await start();
    else if (cmd === 'msg') await msg(process.argv.slice(3).join(' '));
    else if (cmd === 'end') {
      await clean();
      console.log('cleaned up.');
    } else console.log('usage: start | msg "text" | end');
  } finally {
    await sql.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
