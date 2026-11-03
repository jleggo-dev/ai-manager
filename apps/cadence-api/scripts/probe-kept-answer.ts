/**
 * LIVE PROBE: does a described-meal read survive the phone being left?
 *
 * The lock-screen contract for a food read, testable without a phone (the coach's own is
 * probe-backgrounded-phone.ts). It mints a throwaway Supabase user, sends a read to the DEPLOYED
 * cadence-api under a client-made request id, kills the connection two seconds in — which is
 * what iOS does to a request when the app leaves the screen — and then asks GET /answers/:id the
 * way the app does on return, until the answer is there or the server says the run was lost.
 *
 * WHY THIS EXISTS: the fix rests on the invocation running to completion after the client
 * disconnects and writing the answer BEFORE it answers (services/kept-answers.ts). The first
 * half was measured for the coach stream on 2026-08-14; this is the measurement for a plain
 * JSON route, and it is the check to run after every deploy that touches the read.
 *
 * Verdict lines:
 *   KEPT   — the answer was on file after the client vanished: the contract holds.
 *   LOST   — the server claimed the run and never finished it: the invocation did not outlive
 *            the client. The client reports this as a fault with a way to try again, but the
 *            contract does not hold and the read must move to a durable run.
 *   UNKNOWN — the server never recorded the request: the deploy does not carry 0065 / #this.
 *
 * Run:  npm -w apps/cadence-api run probe:kept-answer
 *       MEAL="a pint of Rickard's Red" npm -w apps/cadence-api run probe:kept-answer   # the slow path
 *       CONTROL=1 …   # stay connected, to compare the timings
 *
 * Sanctioned path (prod cadence-api → prod AI Admin), and it cleans up after itself: the auth
 * user and every cadence row it created are deleted on exit, success or failure.
 */
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv({ path: path.join(root, 'apps/cadence-api/.env') });
// After dotenv, so the client sees the connection string (the same client the API runs on).
const { sql } = await import('../src/db/sql.ts');

const SUPA = process.env.CADENCE_SUPABASE_URL ?? '';
const ANON = process.env.CADENCE_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.CADENCE_SUPABASE_SERVICE_ROLE_KEY ?? '';
const API = (process.env.CADENCE_API_BASE_URL || 'https://ai-manager-cadence-api-2f4j.vercel.app').replace(/\/+$/, '');
/** The meal. A maker-named food takes the second round to the web and runs 20–90 s. */
const MEAL = process.env.MEAL ?? 'a bowl of oats with milk and a banana';
const KILL_AFTER_MS = Number(process.env.KILL_MS ?? 2000);
const CONTROL = process.env.CONTROL === '1';
/** How long to keep asking after the answer before calling it lost ourselves. */
const WAIT_MAX_MS = 4 * 60_000;

if (!SUPA || !ANON || !SERVICE) {
  console.error('Missing CADENCE_SUPABASE_* in apps/cadence-api/.env — cannot mint a test user.');
  process.exit(1);
}

const stamp = new Date()
  .toISOString()
  .replace(/[^0-9]/g, '')
  .slice(0, 14);
const email = `e2e-keptprobe-${stamp}@cadence.test`;
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

/** Send the read, then vanish `killAfterMs` in — the phone going to background. */
async function sendAndVanish(requestId: string): Promise<void> {
  const ctrl = new AbortController();
  const t0 = Date.now();
  const timer = CONTROL ? null : setTimeout(() => ctrl.abort(), KILL_AFTER_MS);
  try {
    const res = await fetch(`${API}/nutrition/meals/preview`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ text: MEAL, meal: 'dinner', request_id: requestId }),
      signal: ctrl.signal,
    });
    const body = (await res.json()) as { items?: unknown[] };
    console.log(
      `  answered live: ${res.status} after ${Date.now() - t0}ms (${body.items?.length ?? 0} rows) — control run`,
    );
  } catch (e) {
    console.log(`  ✂️  client vanished after ${Date.now() - t0}ms (${(e as Error).name}) — iOS suspending the webview`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function askAfter(
  requestId: string,
): Promise<{ status: string; answer?: { items?: unknown[] }; fault?: unknown }> {
  const res = await fetch(`${API}/answers/${requestId}`, { headers: auth() });
  return (await res.json()) as { status: string; answer?: { items?: unknown[] }; fault?: unknown };
}

async function cleanup(): Promise<void> {
  if (!userId) return;
  console.log('\n── cleanup ──');
  await fetch(`${SUPA}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  })
    .then((r) => console.log(`auth user deleted: ${r.status}`))
    .catch((e) => console.log('auth delete failed', e));
  try {
    // cadence.users cascades to every row the probe wrote (kept_answers, ai_log, …).
    const gone = await sql`delete from cadence.users where id = ${userId}`;
    console.log(`cadence rows deleted (${gone.count} user row, cascaded)`);
  } catch (e) {
    console.log('cadence delete failed', e);
  } finally {
    await sql.end();
  }
}

async function main(): Promise<void> {
  await createUser();
  await signIn();
  const requestId = crypto.randomUUID();
  console.log(`\n── the read, ${CONTROL ? 'watched to the end' : 'abandoned mid-request'} ──`);
  console.log(`  "${MEAL}"  request ${requestId}`);
  const t0 = Date.now();
  await sendAndVanish(requestId);

  console.log('\n── asking /answers/:id, exactly as the app does on return ──');
  const deadline = Date.now() + WAIT_MAX_MS;
  for (;;) {
    const a = await askAfter(requestId);
    const at = `t+${((Date.now() - t0) / 1000).toFixed(1)}s`;
    if (a.status === 'done') {
      console.log(`  ${at}  done — ${a.answer?.items?.length ?? 0} rows on file`);
      console.log('\nVERDICT: KEPT — the answer was there for a client that had left.');
      return;
    }
    if (a.status === 'failed') {
      console.log(`  ${at}  failed — ${JSON.stringify(a.fault)}`);
      console.log('\nVERDICT: KEPT — the read refused, and the refusal was kept for the client that left.');
      return;
    }
    if (a.status === 'lost') {
      console.log(`  ${at}  lost`);
      console.log(
        '\nVERDICT: LOST — the server claimed the run and never finished it: the invocation did not outlive the client.',
      );
      process.exitCode = 2;
      return;
    }
    if (a.status === 'unknown') {
      console.log(`  ${at}  unknown`);
      console.log(
        '\nVERDICT: UNKNOWN — the server never recorded the request. Is 0065 applied and the route deployed?',
      );
      process.exitCode = 2;
      return;
    }
    console.log(`  ${at}  ${a.status}`);
    if (Date.now() > deadline) {
      console.log('\nVERDICT: still running past our own patience — treat as LOST and look at the function logs.');
      process.exitCode = 2;
      return;
    }
    await sleep(3_000);
  }
}

main()
  .catch((e) => {
    console.error('\nprobe failed:', e);
    process.exitCode = 1;
  })
  .finally(() => void cleanup());
