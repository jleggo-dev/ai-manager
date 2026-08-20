/**
 * The threading measurement (owner ask, 2026-08-20): with the flag on, what does a coach turn
 * actually BILL once the conversation lives in Devs.ai's ThreadWorkflow instead of our upload?
 *
 * Rides the eval harness's world (real user, real JWT, committed plan) and the REAL coach path —
 * cadence-api → in-process engine → v2 — because that is the path users pay for. Turn 1 has no
 * anchor yet, so it is the stateless control (~20.4–20.9k on the 2026-08-19 baseline). The #252
 * anchor lands after it; turns 2 and 3 are the experiment. Per-turn prompt tokens are read from
 * cadence.ai_log, the same rows every other measurement in PLAN.md used.
 *
 * Expected if threading engages: turns 2–3 in the ~9–13k band and FLAT. If they bill like turn 1,
 * threading did not engage — check provider_metadata on the AI Admin session for the anchor.
 *
 * Run: node --import tsx apps/cadence-api/scripts/probe-thread-turns.ts
 */
import { sql } from '../src/db/sql.ts';
import { API, missingEnv, setUp, tearDown, type World } from './eval-tool-selection-world.ts';

const TURNS = [
  'quick one — is it better to stretch before or after tomorrow’s easy run?',
  'after, got it. how many minutes is actually worth doing?',
  'ok — and does foam rolling add anything on top, or is that mostly hype?',
  'what about the calves specifically, mine are always tight',
  'is that from the running or from sitting all day at a desk?',
  'huh. so a standing desk would actually help my calves?',
  'ok. back to the run — should i eat before an easy morning run or go fasted?',
  'and coffee first — yes or no?',
  'how long before the run should the coffee be?',
  'got it. does any of this change for the long run on sunday?',
  'ok last one — what should i do tonight to be ready for tomorrow?',
  'thanks. give me the one-line version of tonight and tomorrow.',
];

async function openSession(token: string): Promise<string> {
  const res = await fetch(`${API}/coach/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent: 'ongoing', healthAvailable: false, healthAnswered: true }),
  });
  const body = (await res.json()) as { sessionId?: string };
  if (!res.ok || !body.sessionId) throw new Error(`open session failed: ${res.status} ${JSON.stringify(body)}`);
  return body.sessionId;
}

/** Send one message and drain the SSE to the end — the route's bookkeeping runs before it closes. */
async function sendTurn(token: string, sessionId: string, message: string): Promise<void> {
  const res = await fetch(`${API}/coach/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok || !res.body) throw new Error(`send failed: ${res.status} ${await res.text()}`);
  const reader = res.body.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
}

async function lastTurnTokens(userId: string): Promise<{ prompt: number; completion: number }> {
  const [row] = await sql<{ prompt: number | null; completion: number | null }[]>`
    select (meta->>'promptTokens')::int as prompt, (meta->>'completionTokens')::int as completion
      from cadence.ai_log
     where user_id = ${userId} and kind = 'coach'
     order by created_at desc limit 1`;
  return { prompt: row?.prompt ?? 0, completion: row?.completion ?? 0 };
}

async function main() {
  const missing = missingEnv();
  if (missing) throw new Error(missing);

  let world: World | null = null;
  try {
    world = await setUp();
    console.log(`world: ${world.email}`);
    const sessionId = await openSession(world.token);
    console.log(`coach session: ${sessionId}\n`);

    const rows: number[] = [];
    for (let i = 0; i < TURNS.length; i++) {
      const t0 = Date.now();
      await sendTurn(world.token, sessionId, TURNS[i] as string);
      const { prompt, completion } = await lastTurnTokens(world.userId);
      rows.push(prompt);
      console.log(
        `turn ${i + 1}: prompt ${prompt.toLocaleString()} tokens · completion ${completion.toLocaleString()} · ${Math.round((Date.now() - t0) / 1000)}s`,
      );
    }

    console.log('\n════════ THE CURVE ════════');
    console.log('turn 1 is the stateless control; 2+ are threaded (anchor verified live 2026-08-20).');
    rows.forEach((p, i) => {
      const d = i > 0 && rows[i - 1] ? p - (rows[i - 1] as number) : 0;
      console.log(`turn ${String(i + 1).padStart(2)}: ${p.toLocaleString().padStart(8)}  ${i > 0 ? (d >= 0 ? '+' : '') + d.toLocaleString() : ''}`);
    });
    const half = Math.floor(rows.length / 2);
    const late = rows.slice(half).filter(Boolean);
    const lateAvgDelta = late.length > 1 ? ((late[late.length - 1] as number) - (late[0] as number)) / (late.length - 1) : 0;
    console.log(`\nlate-half growth: ${Math.round(lateAvgDelta).toLocaleString()} tokens/turn (stateless baseline grew ~870/turn)`);
    console.log(`AI Admin sessionId: ${sessionId}`);
  } finally {
    await tearDown(world);
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
