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
import path from 'node:path';
import { buildContextPack } from '../src/services/context-pack.ts';
import { openCoachSession, injectCoachContext, sendCoachMessage, recordCoachReply } from '../src/ai/aim.ts';
import { runCaptureExtract } from '../src/services/capture.ts';
import { sql } from '../src/db/sql.ts';

const DEV = '00000000-0000-4000-a000-000000000001';
const SESSION_FILE = path.join(
  'C:/Users/jfleg/AppData/Local/Temp/claude/C--Users-jfleg/aa690f49-9958-421f-9c84-ebbb929f836f/scratchpad',
  'coach-sim-session.txt',
);

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
  fs.writeFileSync(SESSION_FILE, s.sessionId);
  console.log(`session started (${s.sessionId}) · pack ${pack.mode} · fns: ${pack.provenance.map((p) => p.fn).join(', ')}`);
  console.log('(UI shows a fixed greeting; the coach LLM replies to your first message)');
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
