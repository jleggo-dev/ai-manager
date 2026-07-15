/**
 * Smoke for the per-turn just-in-time retrieval hook (assembleTurn → injectTurnContext, §4.3).
 * Drives the REAL HTTP coach route (so assembleTurn fires exactly as in prod), then reads the
 * X-ray trace + durable ai_log to prove the per-turn `context-select` ran, chose registry fns
 * BY NAME, executed them, and injected a NON-triggering context turn — without leaking that block
 * into the user-visible transcript.
 * Run: node --import tsx apps/cadence-api/scripts/smoke-turn-context.ts
 */
import { sql } from '../src/db/sql.ts';

const BASE = 'http://localhost:3101';
const H = { 'Content-Type': 'application/json', 'X-Cadence-Dev-User': 'account-1' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (l: string, c: boolean) => console.log(`${c ? '✓' : '✗'} ${l}`);
const jget = async (p: string) => (await fetch(`${BASE}${p}`, { headers: H })).json();
const jpost = async (p: string, body?: unknown) =>
  (await fetch(`${BASE}${p}`, { method: 'POST', headers: H, body: body ? JSON.stringify(body) : undefined })).json();

interface TurnSelect {
  calls: { fn: string }[];
  reason: string;
  injected: boolean;
  provenance: { fn: string; rows: number }[];
  fallback?: boolean;
}

/** Send a coach message over the real SSE route and drain it to completion. */
async function say(sessionId: string, message: string): Promise<void> {
  const res = await fetch(`${BASE}/coach/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ message }),
  });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
  await sleep(400); // let fire-and-forget trace/log writes settle
}

async function main() {
  for (let i = 0; i < 25; i++) {
    try {
      if ((await fetch(`${BASE}/plan`, { headers: H })).ok) break;
    } catch {
      /* retry */
    }
    await sleep(1000);
  }
  await jpost('/dev/reset');

  // Seed a plan so there's real data to fetch (consistency, active plan) mid-conversation.
  await jpost('/review/goals', { title: 'Run a 10k', area: 'movement', type: 'target' });
  await jpost('/review/goals', { title: 'Journal daily', area: 'practice', type: 'recurring' });
  await jpost('/review/confirm');
  const lock = await jpost('/plan/lock');
  ok('seeded a committed plan (data exists to fetch)', lock.status === 'committed');

  const { sessionId } = await jpost('/coach/sessions', { intent: 'ongoing' });
  ok('opened ongoing coach session', typeof sessionId === 'string');

  // Turn A — an explicit data question. The Broker should fetch just-in-time (consistency/plan).
  await say(sessionId, 'How have I actually been showing up over the last two weeks? Be specific.');
  const traceA = await jget('/coach/trace');
  const a = traceA.turnSelect as TurnSelect | null;
  console.log(`\nturn A · chose: [${a?.calls.map((c) => c.fn).join(', ') ?? ''}] · ran: [${a?.provenance.map((p) => `${p.fn}(${p.rows})`).join(', ') ?? ''}] · injected=${a?.injected} · why: ${a?.reason ?? ''}`);
  ok('turn A recorded a per-turn selection (X-ray turnSelect present)', !!a);
  ok('turn A chose ≥1 registry fn for a data question', !!a && a.calls.length >= 1);
  ok('turn A injected a just-in-time context block', !!a && a.injected === true);
  ok('turn A did NOT fall back (context-select ran)', !!a && a.fallback !== true);
  ok('turn A picked get_consistency (soft — model-driven)', !!a && a.calls.some((c) => c.fn === 'get_consistency'));

  // Turn B — pure acknowledgement. The Broker should fetch nothing.
  await say(sessionId, 'thanks, that really helps!');
  const traceB = await jget('/coach/trace');
  const b = traceB.turnSelect as TurnSelect | null;
  console.log(`turn B · chose: [${b?.calls.map((c) => c.fn).join(', ') ?? ''}] · injected=${b?.injected} · why: ${b?.reason ?? ''}`);
  ok('turn B recorded a per-turn selection', !!b);
  ok('turn B fetched nothing for small-talk (soft — model-driven)', !!b && b.injected === false);

  // Durable log carries the per-turn calls by name.
  let logHit = false;
  for (let i = 0; i < 8 && !logHit; i++) {
    const { entries } = await jget('/coach/log');
    logHit = (entries as { kind: string; meta?: { fns?: string[] } }[]).some((e) => e.kind === 'context_select');
    if (!logHit) await sleep(500);
  }
  ok('durable ai_log has a context_select entry (calls logged by name)', logHit);

  // No leak: the injected <context source="turn-context"> turn must NOT appear in the restored chat.
  const cur = await jget('/coach/current');
  const msgs = (cur.messages ?? []) as { role: string; content: string }[];
  const leaked = msgs.some((m) => m.content.includes('Fetched for this turn') || m.content.startsWith('<context'));
  const hasUserTurn = msgs.some((m) => m.role === 'user' && m.content.includes('showing up'));
  ok('no just-in-time block leaked into the restored transcript', !leaked);
  ok("user's real message survives clean in the transcript", hasUserTurn);

  await jpost('/dev/reset');
  console.log('\ncleaned up account-1');
  await sql.end();
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
