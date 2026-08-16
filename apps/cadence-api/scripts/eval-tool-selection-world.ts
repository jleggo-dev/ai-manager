/**
 * The world the eval's coach is talking to — one throwaway account, seeded to look like somebody
 * six weeks in, and deleted on exit whatever happens.
 *
 * WHY SEED AT ALL. Tool selection is not measured in a vacuum: a coach whose file is empty behaves
 * differently from one who can see a plan. `propose_plan_change` on a user with no plan returns
 * "they have no active plan yet — offer to build one", and the dossier says as much at session
 * open, so an empty account would score her as failing to reach for a tool she was right to leave
 * alone. Every case in `eval-tool-selection-cases.ts` names something that exists here — the
 * farmer carries she is asked to swap, the Thursday run she is asked to move, the 100 books she is
 * asked to halve — so a miss is a miss and not a shrug at an empty file.
 *
 * WHAT IT DELIBERATELY LEAVES EMPTY. No journal entries, no recipes, no food log, no Apple Health
 * import. Those tools' cases (B1–B4, B6) test whether she REACHES for them, and the decision to
 * call is made before any result comes back — so an empty answer costs the measurement nothing,
 * while the row counts in the catalog keep the Broker from prefetching them and doing her job for
 * her. That asymmetry is deliberate and it is why these four are the fairest reads in the set.
 *
 * The account is `e2e-toolsel-*@cadence.test`, which `npm run cleanup:cadence-dev-accounts` also
 * sweeps if a run is ever killed before `teardown()`.
 */
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv({ path: path.join(root, 'apps/cadence-api/.env') });

export const SUPA = process.env.CADENCE_SUPABASE_URL ?? '';
const ANON = process.env.CADENCE_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.CADENCE_SUPABASE_SERVICE_ROLE_KEY ?? '';
export const API = (process.env.CADENCE_API_BASE_URL || 'https://ai-manager-cadence-api-2f4j.vercel.app').replace(
  /\/+$/,
  '',
);

export interface World {
  userId: string;
  email: string;
  token: string;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const daysAgo = (n: number): Date => new Date(Date.now() - n * 86_400_000);

/** The most recent date in the last `back` days that fell on `dow` (0=Sun). */
function lastDow(dow: number, back = 14): string {
  for (let i = 1; i <= back; i += 1) {
    const d = daysAgo(i);
    if (d.getUTCDay() === dow) return iso(d);
  }
  return iso(daysAgo(7));
}

export function missingEnv(): string | null {
  if (!SUPA || !ANON || !SERVICE) return 'Missing CADENCE_SUPABASE_* in apps/cadence-api/.env — cannot mint a user.';
  return null;
}

async function createUser(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPA}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = (await res.json()) as { id?: string };
  if (!res.ok || !body.id) throw new Error(`create user failed: ${res.status} ${JSON.stringify(body)}`);
  return body.id;
}

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json()) as { access_token?: string };
  if (!res.ok || !body.access_token) throw new Error(`sign-in failed: ${res.status}`);
  return body.access_token;
}

/** The plan, exactly as the cases talk about it. Titles are load-bearing: the action tools match
 *  commitments by title, so "the grip finisher" has to be findable by that name. */
const ACTIVITIES = [
  {
    title: 'Easy run',
    goal: 'Run a 10k in October',
    recurrence: 'FREQ=WEEKLY;BYDAY=TU,TH',
    duration: 40,
    how_to: 'Conversational pace the whole way. Flat routes while the knee is still a question.',
  },
  {
    title: 'Long run',
    goal: 'Run a 10k in October',
    recurrence: 'FREQ=WEEKLY;BYDAY=SU',
    duration: 75,
    how_to: 'Slow. Walk the hills if you need to.',
  },
  {
    title: 'Grip finisher',
    goal: 'Get a bar hang back',
    recurrence: 'FREQ=WEEKLY;BYDAY=TU',
    duration: 10,
    how_to: 'Farmers carries — three trips, as heavy as you can hold for forty seconds.',
  },
  {
    title: 'Morning sit',
    goal: 'Sit for ten minutes most mornings',
    recurrence: 'FREQ=DAILY',
    duration: 10,
    how_to: '',
  },
];

const GOALS = [
  {
    title: 'Run a 10k in October',
    area: 'movement',
    type: 'target',
    measure: { target: 10, unit: 'km' },
    end: '2026-10-11',
  },
  {
    title: 'Read 100 books this year',
    area: 'practice',
    type: 'target',
    measure: { target: 100, unit: 'books' },
    end: '2026-12-31',
  },
  { title: 'Sit for ten minutes most mornings', area: 'mind', type: 'recurring', measure: {}, end: undefined },
  { title: 'Get a bar hang back', area: 'movement', type: 'recurring', measure: {}, end: undefined },
];

/** Sessions already on file, so `log_session` / `correct_log` / `get_recent_logs` have real rows to
 *  name. Sunday's long run is recorded as done on purpose — case A8 asks her to un-record it. */
const REPORTS: Array<{ title: string; dow: number; value: Record<string, number>; summary: string; raw: string }> = [
  {
    title: 'Long run',
    dow: 0,
    value: { distance_km: 11.4, duration_min: 77 },
    summary: '11.4 km in 77 minutes, heart rate high on the hills',
    raw: 'long one done. 77 mins. hr all over the place on the hills again',
  },
  {
    title: 'Easy run',
    dow: 2,
    value: { distance_km: 5, duration_min: 31 },
    summary: '5 km in 31 minutes, felt easy',
    raw: 'easy 5k, felt fine',
  },
  {
    title: 'Grip finisher',
    dow: 2,
    value: { sets: 3 },
    summary: 'Three carries, forty seconds each',
    raw: 'did the carries, hands hate me',
  },
];

/** Seed straight into the DB rather than through the app: this run should pay for the coach turns
 *  under test and nothing else — a first plan build is four model calls we do not need. */
export async function seed(userId: string, token: string): Promise<void> {
  await fetch(`${API}/plan`, { headers: { Authorization: `Bearer ${token}` } });

  const { sql, json } = await import('../src/db/sql.ts');
  const { setName, mergeBaseline, mergeCapturedConstraints, setMacroTargets } = await import('../src/repos/users.ts');
  const { insertGoal } = await import('../src/repos/goals.ts');
  const { insertPlan } = await import('../src/repos/plans.ts');
  const { insertActivities } = await import('../src/repos/activities.ts');
  const { insertEquipment } = await import('../src/repos/equipment.ts');
  const { randomUUID } = await import('node:crypto');

  await setName(userId, 'Sam');
  await mergeBaseline(userId, {
    weight_kg: { current: 84.2, start: 90, source: 'manual', updated_at: iso(daysAgo(2)) },
    height_cm: 181,
    sex: 'male',
  });
  await mergeCapturedConstraints(userId, [
    { id: randomUUID(), label: 'right knee', kind: 'physical', status: 'active', plan_around: true },
  ]);
  await setMacroTargets(userId, { kcal: 2200, protein_g: 165, carbs_g: 220, fat_g: 70 });
  for (const e of [
    { name: 'adjustable dumbbells', category: 'strength' },
    { name: 'pull-up bar', category: 'strength' },
    { name: 'road shoes', category: 'footwear' },
  ]) {
    await insertEquipment(userId, e as never);
  }

  const goalIdByTitle: Record<string, string> = {};
  for (const g of GOALS) {
    const row = await insertGoal(userId, {
      title: g.title,
      area: g.area as never,
      type: g.type as never,
      measure: g.measure as never,
      timeframe: (g.end ? { end: g.end } : {}) as never,
      status: 'committed',
      source: 'captured',
    });
    goalIdByTitle[g.title] = row.goal_id;
  }

  const plan = await insertPlan(userId, {
    goal_ids: Object.values(goalIdByTitle),
    generated_by: 'coach',
    version: 1,
    status: 'active',
    rationale: 'Two easy runs and a long one for the 10k, one grip session, and a daily sit.',
  });
  const activities = await insertActivities(
    userId,
    plan.plan_id,
    ACTIVITIES.map((a) => ({
      goal_id: goalIdByTitle[a.goal],
      title: a.title,
      kind: 'user' as const,
      schedule: { recurrence: a.recurrence, duration_min: a.duration } as never,
      how_to: a.how_to || null,
    })),
  );
  const idByTitle = new Map(activities.map((a) => [a.title, a.activity_id]));

  for (const r of REPORTS) {
    const activityId = idByTitle.get(r.title);
    if (!activityId) continue;
    const date = lastDow(r.dow);
    const log = {
      items: [],
      summary: r.summary,
      raw_text: r.raw,
      logged_at: new Date(`${date}T18:00:00Z`).toISOString(),
    };
    await sql`
      insert into cadence.occurrences (activity_id, user_id, date, status, value, log)
      values (${activityId}, ${userId}, ${date}, 'done', ${json(r.value)}, ${json(log)})
      on conflict (activity_id, date) do nothing`;
  }
  // A couple of pending days ahead, so the week reads like a week rather than a history.
  for (const a of activities) {
    for (let i = 1; i <= 4; i += 1) {
      await sql`
        insert into cadence.occurrences (activity_id, user_id, date, status)
        values (${a.activity_id}, ${userId}, ${iso(new Date(Date.now() + i * 86_400_000))}, 'pending')
        on conflict (activity_id, date) do nothing`;
    }
  }
}

export async function setUp(): Promise<World> {
  const stamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 14);
  const email = `e2e-toolsel-${stamp}@cadence.test`;
  const password = `Eval!${stamp}aA1`;
  const userId = await createUser(email, password);
  const token = await signIn(email, password);
  console.log(`✓ ${email} (real JWT, the same kind the phone carries)`);
  await seed(userId, token);
  console.log('✓ world seeded: 4 goals, a committed plan of 4 commitments, 3 sessions on file, a knee');
  return { userId, email, token };
}

/** Runs on every exit path. cadence.users cascades to every child row it owns. */
export async function tearDown(world: World | null): Promise<void> {
  if (!world?.userId) return;
  console.log('\n── cleanup ──');
  await fetch(`${SUPA}/auth/v1/admin/users/${world.userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  })
    .then((r) => console.log(`auth user deleted: ${r.status}`))
    .catch((e) => console.error('auth delete failed', e));
  try {
    const { sql } = await import('../src/db/sql.ts');
    await sql`delete from cadence.users where id = ${world.userId}`;
    await sql.end({ timeout: 5 });
    console.log('cadence rows deleted (cascade)');
  } catch (e) {
    console.error('db cleanup failed — sweep with npm run cleanup:cadence-dev-accounts:', e);
  }
}
