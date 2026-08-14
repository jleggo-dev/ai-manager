/**
 * LIVE PROBE: the backgrounded phone — does a coach turn survive the app being left?
 *
 * The doom-scroll contract, testable without a phone. It mints a throwaway Supabase user, opens
 * a real coach session against the DEPLOYED cadence-api with a real JWT, starts reading the SSE
 * stream, and then kills the read a couple of seconds in — which is precisely what iOS does when
 * someone switches apps mid-turn. Then it polls `/coach/current` the way the app does on return
 * and reports whether her reply was actually kept.
 *
 * WHY THIS EXISTS: this failure cost five rounds of device testing and was never reproduced,
 * because reproducing it needed a phone, a slow turn, and the discipline to switch apps at the
 * right moment. Everything the app does to survive being left — the relay draining server-side,
 * the build committing regardless, the recovery poll — was resting on an assumption written in a
 * comment ("the serverless invocation runs to completion whether or not the client is still
 * listening") that nobody had tested, and that turned out to be false in the way that mattered.
 *
 * VERDICT (2026-08-14, after #195): GREEN.
 *   before — reply generated (1452 chars, in ai_log) and thrown away: the assistant turn never
 *            reached chat history, so the app returned to "connection dropped, send again"
 *   after  — the reply is on file by t+25s, and `generating` flips false only once it is, so a
 *            returning client never sees "nothing generating, nothing here"
 * The cause was fire-and-forget persistence: work started after the handler returns races the
 * platform reclaiming the instance, and with nobody on the socket that race is lost reliably.
 *
 * Run:  npm -w apps/cadence-api run probe:backgrounded
 *       CONTROL=1 npm -w apps/cadence-api run probe:backgrounded   # let the stream finish
 *
 * Sanctioned path (prod cadence-api → prod AI Admin → Devs.ai) and it cleans up after itself:
 * the auth user and every cadence row it created are deleted on exit, success or failure.
 */
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv({ path: path.join(root, 'apps/cadence-api/.env') });

const SUPA = process.env.CADENCE_SUPABASE_URL ?? '';
const ANON = process.env.CADENCE_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.CADENCE_SUPABASE_SERVICE_ROLE_KEY ?? '';
const API = (process.env.CADENCE_API_BASE_URL || 'https://ai-manager-cadence-api-2f4j.vercel.app').replace(/\/+$/, '');
/** How long to read before vanishing. Long enough to be mid-reply, short enough to be brutal. */
const KILL_AFTER_MS = Number(process.env.KILL_MS ?? 2500);
const CONTROL = process.env.CONTROL === '1';

if (!SUPA || !ANON || !SERVICE) {
  console.error('Missing CADENCE_SUPABASE_* in apps/cadence-api/.env — cannot mint a test user.');
  process.exit(1);
}

const stamp = new Date()
  .toISOString()
  .replace(/[^0-9]/g, '')
  .slice(0, 14);
const email = `e2e-bgprobe-${stamp}@cadence.test`;
const password = `Probe!${stamp}aA1`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let userId = '';
let token = '';

async function createUser(): Promise<void> {
  const res = await fetch(`${SUPA}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = (await res.json()) as { id?: string };
  if (!res.ok || !body.id) throw new Error(`create user failed: ${res.status} ${JSON.stringify(body)}`);
  userId = body.id;
  console.log(`✓ test user ${email}`);
}

async function signIn(): Promise<void> {
  const res = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json()) as { access_token?: string };
  if (!res.ok || !body.access_token) throw new Error(`sign-in failed: ${res.status}`);
  token = body.access_token;
  console.log('✓ real JWT (the same kind the phone carries)');
}

const auth = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

async function openSession(): Promise<string> {
  const res = await fetch(`${API}/coach/sessions`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ intent: 'onboarding', healthAvailable: false, healthAnswered: true }),
  });
  const body = (await res.json()) as { sessionId?: string };
  if (!res.ok || !body.sessionId) throw new Error(`open session failed: ${res.status} ${JSON.stringify(body)}`);
  console.log(`✓ coach session ${body.sessionId}`);
  return body.sessionId;
}

/** Start the turn, read for `killAfterMs`, then hard-abort. The phone going to background. */
async function sendAndVanish(sessionId: string, message: string, killAfterMs: number): Promise<void> {
  const ctrl = new AbortController();
  const t0 = Date.now();
  let bytes = 0;
  const timer = setTimeout(() => ctrl.abort(), killAfterMs);
  try {
    const res = await fetch(`${API}/coach/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { ...auth(), Accept: 'text/event-stream' },
      body: JSON.stringify({ message }),
      signal: ctrl.signal,
    });
    console.log(`  stream opened: ${res.status}`);
    const reader = res.body!.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value?.length ?? 0;
    }
    console.log(`  stream completed normally (${bytes} bytes) — control run`);
  } catch (e) {
    console.log(`  ✂️  client vanished after ${Date.now() - t0}ms (${(e as Error).name}) — iOS suspending the webview`);
  } finally {
    clearTimeout(timer);
  }
}

async function current(): Promise<{ generating?: boolean; messages: { role: string; content: string }[] }> {
  const res = await fetch(`${API}/coach/current`, { headers: auth() });
  return (await res.json()) as { generating?: boolean; messages: { role: string; content: string }[] };
}

async function cleanup(): Promise<void> {
  if (!userId) return;
  console.log('\n── cleanup ──');
  await fetch(`${SUPA}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  })
    .then((r) => console.log(`auth user deleted: ${r.status}`))
    .catch((e) => console.error('auth delete failed', e));
  // cadence.users cascades to every child row (goals, plan, conversations, ai_log, …).
  const { sql } = await import('../src/db/sql.ts');
  await sql`delete from cadence.users where id = ${userId}`;
  await sql.end({ timeout: 5 });
  console.log('cadence rows deleted (cascade)');
}

async function main(): Promise<void> {
  await createUser();
  await signIn();
  const sessionId = await openSession();

  console.log(CONTROL ? '\n── control: the turn, read to the end ──' : '\n── the turn, abandoned mid-stream ──');
  await sendAndVanish(
    sessionId,
    "I want to get back into running after a long break, and I'd like to understand how to build up safely. Tell me how you'd think about that.",
    CONTROL ? 10 * 60_000 : KILL_AFTER_MS,
  );

  console.log('\n── polling /coach/current, exactly as the app does on return ──');
  let reply = '';
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && !reply) {
    await sleep(5000);
    const c = await current();
    const last = c.messages[c.messages.length - 1];
    reply = last?.role === 'coach' ? last.content.trim() : '';
    const secs = Math.round((120_000 - (deadline - Date.now())) / 1000);
    console.log(
      `t+${secs}s  generating=${c.generating}  messages=${c.messages.length}  ` +
        `reply=${reply ? `${reply.length} chars ✅` : 'none'}`,
    );
  }

  console.log('\n── VERDICT ──');
  if (reply) {
    console.log('✅ THE REPLY SURVIVED. Leaving the app mid-turn does not cost the answer.');
    console.log(`   "${reply.slice(0, 160)}…"`);
  } else {
    console.log('❌ THE REPLY WAS LOST — generated upstream, never persisted, gone.');
    console.log('   This is the regression #195 fixed: persistence must be AWAITED before the');
    console.log('   handler returns, or it races the platform reclaiming the instance.');
  }
  if (!reply) process.exitCode = 1;
}

try {
  await main();
} catch (e) {
  console.error('\nprobe failed:', e);
  process.exitCode = 1;
} finally {
  await cleanup();
}
