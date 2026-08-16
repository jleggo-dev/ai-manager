/**
 * LIVE PROBE: "Custom — let's talk" — does the adjustment ever come back?
 *
 * `POST /plan/replan/preview` is the longest single request Cadence makes. With N committed goals
 * it fans out into N concurrent synthesize_plan drafts, then a reduce call, then a vet — and the
 * client holds ONE http request open across all of it. On a phone that is the worst possible
 * shape, and the owner hit exactly what it predicts (2026-08-15): *"It says it's working on
 * options … it never replies — I can't tell if it's working or not."*
 *
 * The three things a comment cannot tell us, and this can:
 *   1. WALL CLOCK — how long the pipeline really takes at 4 goals, the owner's number.
 *   2. WHETHER THE GATEWAY LETS IT FINISH — cadence-api is a long-running Vercel Service, not a
 *      function, so `maxDuration` does not apply; but the proxy in front of it has a request
 *      ceiling of its own and nobody has measured it.
 *   3. WHETHER THE WORK LANDS ANYWAY — previewReplan persists `pending_plan` the moment synthesis
 *      finishes, which is what the client's recovery poll reads. If the connection dying also
 *      kills the work, that recovery is decoration.
 *
 * VANISH=1 kills the read a few seconds in (the phone being backgrounded) and then polls
 * `/plan/replan/pending` exactly as AdjustSheet does, which answers (3) directly.
 *
 * VERDICT (2026-08-16, 4 goals): **271.5s — four and a half minutes — HTTP 200.**
 *   The gateway does not cut it off and the proposal is real. The failure was entirely on our
 *   side of the wire: the sheet showed one unchanging "Looking at your options…" for the whole
 *   271 seconds with no elapsed cue and no leave-safety, and its recovery poll gave up at 180s —
 *   ninety seconds BEFORE the pipeline could possibly finish. So a phone that backgrounded (or a
 *   person who simply doubted it was working) could not be rescued even in principle.
 *   Fixed: an honest multi-minute wait with progress, an 8-minute recovery window, a resume check,
 *   and a push when it lands.
 *
 * Run:  npm -w apps/cadence-api run probe:replan
 *       VANISH=1 npm -w apps/cadence-api run probe:replan
 *       GOALS=6 npm -w apps/cadence-api run probe:replan     # headroom check
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
const VANISH_MS = process.env.VANISH === '1' ? Number(process.env.KILL_MS ?? 4000) : 0;
const GOAL_COUNT = Number(process.env.GOALS ?? 4);

if (!SUPA || !ANON || !SERVICE) {
  console.error('Missing CADENCE_SUPABASE_* in apps/cadence-api/.env — cannot mint a test user.');
  process.exit(1);
}

/** The owner's actual shape on 2026-08-15: four committed goals across three areas. */
const GOALS = [
  { title: 'Run a half marathon in the spring', area: 'movement', type: 'target' },
  { title: 'Get stronger — pull-ups and grip', area: 'movement', type: 'recurring' },
  { title: 'Sit for 15 minutes most mornings', area: 'mind', type: 'recurring' },
  { title: 'Keep an evening journal', area: 'practice', type: 'recurring' },
  { title: 'Eat more whole food at lunch', area: 'nourishment', type: 'recurring' },
  { title: 'Sleep seven hours on weeknights', area: 'mind', type: 'recurring' },
];

/** The owner's own words into the sheet — a constraint they want lifted, not a new goal. */
const STEER = "You're being overly protective of my elbow — I'm good for dead hangs now.";

const stamp = new Date()
  .toISOString()
  .replace(/[^0-9]/g, '')
  .slice(0, 14);
const email = `e2e-replanprobe-${stamp}@cadence.test`;
const password = `Probe!${stamp}aA1`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

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

/** First authenticated request provisions cadence.users; then seed goals straight into the DB so
 *  the probe pays for ONE synthesis (the one under test) rather than a whole first-lock build. */
async function seed(): Promise<void> {
  const res = await fetch(`${API}/plan`, { headers: auth() });
  console.log(`✓ user provisioned via GET /plan (${res.status})`);
  const { sql } = await import('../src/db/sql.ts');
  for (const g of GOALS.slice(0, GOAL_COUNT)) {
    await sql`insert into cadence.goals (user_id, title, area, type, status, source)
              values (${userId}, ${g.title}, ${g.area}, ${g.type}, 'committed', 'captured')`;
  }
  console.log(`✓ ${GOAL_COUNT} committed goals seeded (fan-out drafts ${GOAL_COUNT} + 1 reduce)`);
}

/** The request AdjustSheet makes. Returns how it ended and how long it took. */
async function preview(killAfterMs: number): Promise<{ how: string; ms: number; body?: string }> {
  const ctrl = new AbortController();
  const t0 = Date.now();
  const timer = killAfterMs ? setTimeout(() => ctrl.abort(), killAfterMs) : undefined;
  try {
    const res = await fetch(`${API}/plan/replan/preview`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ steer: STEER }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    return { how: `HTTP ${res.status}`, ms: Date.now() - t0, body: text.slice(0, 300) };
  } catch (e) {
    return { how: `connection died (${(e as Error).name}: ${(e as Error).message})`, ms: Date.now() - t0 };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** AdjustSheet's recovery half — is the finished proposal sitting on file? Network weather during
 *  a multi-minute poll is normal (the client treats it the same way): keep polling, never throw. */
async function pending(): Promise<number | null> {
  try {
    const res = await fetch(`${API}/plan/replan/pending`, { headers: auth() });
    if (!res.ok) return null;
    const body = (await res.json()) as { proposal?: { activities?: unknown[] } | null };
    return body.proposal ? (body.proposal.activities?.length ?? 0) : null;
  } catch {
    return null;
  }
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
  const { sql } = await import('../src/db/sql.ts');
  await sql`delete from cadence.users where id = ${userId}`;
  await sql.end({ timeout: 5 });
  console.log('cadence rows deleted (cascade)');
}

async function main(): Promise<void> {
  await createUser();
  await signIn();
  await seed();

  console.log(
    VANISH_MS
      ? `\n── POST /plan/replan/preview, abandoned after ${VANISH_MS}ms (the phone backgrounding) ──`
      : '\n── POST /plan/replan/preview, held open the way the sheet holds it ──',
  );
  const r = await preview(VANISH_MS);
  console.log(`  ended: ${r.how} after ${secs(r.ms)}`);
  if (r.body) console.log(`  body: ${r.body}`);

  console.log('\n── polling /plan/replan/pending, exactly as AdjustSheet does on a dead fetch ──');
  let landed: number | null = null;
  const deadline = Date.now() + 8 * 60_000;
  const t0 = Date.now();
  while (Date.now() < deadline && landed === null) {
    await sleep(10_000);
    landed = await pending();
    console.log(`  t+${secs(Date.now() - t0)}  pending_plan=${landed === null ? 'none' : `${landed} activities ✅`}`);
  }

  console.log('\n── VERDICT ──');
  console.log(`  request ended ${r.how} at ${secs(r.ms)}`);
  if (landed !== null) {
    console.log(`  ✅ the work LANDED (${landed} activities) — recovery by polling is sound`);
  } else {
    console.log('  ❌ nothing on file after 8 minutes — the work did NOT survive; polling cannot save it');
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (e) {
  console.error('\nprobe failed:', e);
  process.exitCode = 1;
} finally {
  await cleanup();
}
