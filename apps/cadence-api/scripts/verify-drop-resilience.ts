/**
 * Prove a mid-stream client DROP still persists the coach reply (recoverable via
 * GET /coach/current) — the server-side durability behind OnboardingChat's recoverFromServer().
 * Requires cadence-api running on :3101 (dev user, no token). Opens a session, starts streaming,
 * aborts as soon as the first delta arrives, then polls /coach/current for the full reply.
 * Run: node --import tsx apps/cadence-api/scripts/verify-drop-resilience.ts
 */
const BASE = process.env.CADENCE_API_BASE ?? 'http://localhost:3101';
const H = { 'Content-Type': 'application/json' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. open a fresh onboarding session
  const s = (await (
    await fetch(`${BASE}/coach/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ intent: 'onboarding' }) })
  ).json()) as { sessionId: string };
  console.log('session:', s.sessionId);

  // 2. send a message, then ABORT as soon as the first delta arrives (simulated drop)
  const ctrl = new AbortController();
  let partial = '';
  let aborted = false;
  try {
    const res = await fetch(`${BASE}/coach/sessions/${s.sessionId}/messages`, {
      method: 'POST',
      headers: H,
      signal: ctrl.signal,
      body: JSON.stringify({ message: 'I want to run a half marathon in the spring and lose about 10 pounds.' }),
    });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const line of dec.decode(value, { stream: true }).split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const d = line.slice(6).trim();
        if (d === '[DONE]') continue;
        try {
          const del = JSON.parse(d).choices?.[0]?.delta?.content;
          if (typeof del === 'string') partial += del;
        } catch {
          /* keepalive */
        }
      }
      if (partial.length > 0) {
        aborted = true;
        ctrl.abort();
        break;
      } // drop!
    }
  } catch (e) {
    aborted = true;
    console.log('stream aborted (simulated drop):', (e as Error).name);
  }
  console.log('partial before drop :', JSON.stringify(partial.slice(0, 80)) + (partial.length > 80 ? '…' : ''));

  // 3. poll /coach/current for the durably-persisted reply
  let recovered = '';
  for (let i = 0; i < 12; i++) {
    await sleep(800);
    const c = (await (await fetch(`${BASE}/coach/current`, { headers: H })).json()) as {
      messages?: Array<{ role: string; content: string }>;
    };
    const last = c.messages?.[c.messages.length - 1];
    if (last?.role === 'coach' && last.content?.trim()) {
      recovered = last.content;
      break;
    }
  }

  console.log('\n--- recovered reply (persisted despite drop) ---\n' + recovered + '\n');
  console.log('--- checks ---');
  console.log(aborted ? '✓ client drop simulated' : '⚠️ could not abort (reply too fast) — inconclusive');
  console.log(recovered.trim() ? '✓ reply persisted + recoverable via /coach/current' : '✗ reply NOT persisted (durability FAILED)');
  console.log(recovered.length >= partial.length ? '✓ recovered reply ≥ the partial the client saw' : '✗ recovered shorter than partial');

  // cleanup: remove the test conversation so it doesn't pollute the dev user's chat restore
  const { sql } = await import('../src/db/sql.ts');
  const del = await sql`delete from cadence.conversations where ai_session_id = ${s.sessionId}`;
  console.log(`cleaned up ${del.count} test conversation row(s)`);
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
