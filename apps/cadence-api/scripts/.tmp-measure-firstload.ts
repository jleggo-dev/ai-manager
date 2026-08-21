/**
 * First-load latency probe against the DEPLOYED cadence-api (PERF re-measure, 2026-08-20).
 *
 * Walks the real path a phone walks: anonymous Supabase session (what "get started" does) or a
 * password sign-in, then the app-open burst, then a Plan-tab return burst. Reports each hop.
 */
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = '/Users/jeffreyleggo/cadence/ai-manager';
dotenv({ path: path.join(root, 'apps/cadence-api/.env') });

const API = process.env.PROBE_API_BASE || 'https://ai-manager-cadence-api-2f4j.vercel.app';
const SUPA_URL = process.env.CADENCE_SUPABASE_URL!;
const SUPA_ANON = process.env.CADENCE_SUPABASE_ANON_KEY!;

const ms = (n: number) => `${n.toFixed(0)}ms`;

async function timed<T>(label: string, fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const out = await fn();
  const dt = performance.now() - t0;
  console.log(`  ${label.padEnd(42)} ${ms(dt).padStart(8)}`);
  return [out, dt];
}

async function get(pathname: string, token: string) {
  const res = await fetch(`${API}${pathname}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.text();
  return { status: res.status, body, region: res.headers.get('x-vercel-id') ?? '' };
}

async function main() {
  const supa = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });

  console.log(`API   ${API}`);
  console.log(`SUPA  ${SUPA_URL}\n`);

  // --- 0. Is the service cold? Probe /health first WITHOUT warming anything else.
  console.log('COLD PROBE (first byte after idle)');
  await timed('GET /health (cold?)', () => fetch(`${API}/health`).then((r) => r.text()));
  await timed('GET /health (warm)', () => fetch(`${API}/health`).then((r) => r.text()));

  // --- 1. Identity. This is hop one on a real phone.
  console.log('\nAUTH');
  const email = process.env.PROBE_EMAIL;
  const password = process.env.PROBE_PASSWORD;
  let token: string;
  if (email && password) {
    const [r] = await timed('supabase signInWithPassword', () =>
      supa.auth.signInWithPassword({ email, password }),
    );
    if (r.error) throw new Error(`sign-in failed: ${r.error.message}`);
    token = r.data.session!.access_token;
  } else {
    const [r] = await timed('supabase signInAnonymously', () => supa.auth.signInAnonymously());
    if (r.error) throw new Error(`anon sign-in failed: ${r.error.message}`);
    token = r.data.session!.access_token;
  }

  // --- 2. The app-open burst (App.tsx gate + MainTabs first paint).
  console.log('\nAPP OPEN (first authed request pays serverless wake + auth.getUser + ensureUser)');
  const [p1] = await timed('GET /plan            (1st, cold auth)', () => get('/plan', token));
  console.log(`      → ${p1.status} ${p1.region} ${p1.body.slice(0, 90)}`);
  await timed('GET /plan            (2nd, warm)', () => get('/plan', token));
  await timed('GET /plan            (3rd, warm)', () => get('/plan', token));

  console.log('\nPLAN TAB BURST (what a Plan-tab return fires today)');
  const aux: Array<[string, string]> = [
    ['GET /me/daily-checkin', '/me/daily-checkin'],
    ['GET /me/notification-prefs', '/me/notification-prefs'],
    ['GET /me/location', '/me/location'],
    ['GET /me/weather', '/me/weather'],
    ['GET /coach/current', '/coach/current'],
    ['GET /me/coach-face', '/me/coach-face'],
  ];
  for (const [label, p] of aux) {
    const [r] = await timed(label, () => get(p, token));
    if (r.status >= 400) console.log(`      → ${r.status} ${r.body.slice(0, 80)}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  console.log('\nFOOD / PROGRESS');
  await timed('GET /progress', () => get('/progress', token));
  await timed(`GET /nutrition/day?date=${today}`, () => get(`/nutrition/day?date=${today}`, token));
  await timed('GET /nutrition/insight', () => get('/nutrition/insight', token));
  await timed('GET /nutrition/recent?days=7', () => get('/nutrition/recent?days=7', token));
  await timed('GET /nutrition/foods/recents', () => get('/nutrition/foods/recents', token));
  await timed('GET /nutrition/foods/usual?meal=breakfast', () =>
    get('/nutrition/foods/usual?meal=breakfast&limit=3', token),
  );
  await timed('GET /nutrition/meal-plans', () => get('/nutrition/meal-plans', token));
  await timed('GET /nutrition/recipes', () => get('/nutrition/recipes', token));

  // --- 3. Serial vs parallel: the burst as the app fires it (serial-ish) vs all at once.
  console.log('\nBURST SHAPE');
  const burst = () =>
    Promise.all([
      get('/me/daily-checkin', token),
      get('/me/notification-prefs', token),
      get('/me/location', token),
      get('/coach/current', token),
      get('/coach/face', token),
    ]);
  await timed('5 aux requests in PARALLEL', burst);
  await timed('5 aux requests SERIAL', async () => {
    for (const [, p] of aux) await get(p, token);
  });

  console.log('\nuser id:', (await supa.auth.getUser()).data.user?.id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
