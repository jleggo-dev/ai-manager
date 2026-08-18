/**
 * OUTCOME EVAL — after a short real conversation, did the DATABASE end up right?
 *
 * MANUAL GATE, NOT CI. It talks to the deployed API and prod AI Admin, costs real money per run
 * (~1-3 coach turns per scenario plus one judge call), and the thing it measures is stochastic —
 * a single run is a SIGNAL, never a verdict. It also measures the DEPLOYED harness, not your
 * working tree: merge, wait for Vercel, then run it.
 *
 * WHY IT EXISTS. `eval:tools` scores tool SELECTION on first turns. Every silent-drop bug of
 * 2026-08-16/17 — the overwritten card, the dropped rename, the noop card with an Apply button,
 * the padded duration, the "removed" constraint that stayed — SELECTED the right tool and would
 * have passed it. Owner: "I'm catching very simple things on a single test. Every. Single. Time."
 * The missing layer is this one: script a multi-turn conversation through the REAL pipeline, then
 * assert on `cadence.*` state, never on her prose.
 *
 * WHAT ONE SCENARIO DOES (cases in `eval-outcome-scenarios.ts`):
 *   1. Mint a throwaway Supabase auth user whose id follows `services/test-user.ts`'s pid-suffix
 *      pattern (`00000000-0000-4000-a000-ec<nn><pid>`), so concurrent runs cannot collide and
 *      `npm run cleanup:test-data` (scripts/account.ts sweep) reclaims a crashed run's rows.
 *   2. Seed its world directly through the app's own repos.
 *   3. Open a session and drive the scripted turns against the deployed API — the same
 *      route/relay/tool-loop path the phone uses (coach chat cannot run in-process locally by
 *      design; see aim-remote.ts).
 *   4. Snapshot the world before and after; run the scenario's asserts; flag ANY undeclared area
 *      delta automatically (the "nothing else changed" negative assert, for every scenario).
 *      Ambient-capture territory — constraints, the rest of baseline, equipment, captured-status
 *      goals — is deliberately OUTSIDE this check: the Broker writes there on most conversations.
 *   5. AI-judges-AI: one extra model call through AI Admin gets her replies plus the COMPLETE
 *      machine-built record of what changed — deliberate deltas, the proposal card in full, and
 *      ambient-capture deltas labelled as such — and answers strict JSON: did she claim something
 *      that did not happen, or bury something that did? That catches the "said done, nothing
 *      happened" class that deterministic asserts cannot see in prose. The judge's evidence is
 *      wider than step 4's on purpose: reusing the failure check's ambient-blind summary once
 *      turned a truthful constraint lift into "no actual changes were recorded". Informational
 *      only; it never gates the exit code. (Hosted on the `pack-summarize` job via promptOverride
 *      — a real job on the Broker profile whose only formatting rule is remove-reasoning, so the
 *      prompt is ours and the run is still audited like any job.)
 *
 * Run:
 *   npm run eval:outcomes -- --dry                 # list scenarios, no network, free
 *   npm run eval:outcomes -- --only resize-noop    # one scenario — the cheap trial
 *   npm run eval:outcomes                          # all of them, 3 at a time
 *   npm run eval:outcomes -- --no-judge            # deterministic asserts only
 *
 * Exit is non-zero when any deterministic assert fails or a scenario errors. Cleans up after
 * itself on every path; a killed run is reclaimed by `npm run cleanup:test-data`.
 */
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCENARIOS,
  type OutcomeScenario,
  type ScenarioContext,
  type SeedSpec,
  type TouchArea,
} from './eval-outcome-scenarios.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv({ path: path.join(root, 'backend/.env') });
dotenv({ path: path.join(root, 'apps/cadence-api/.env') });

const SUPA = process.env.CADENCE_SUPABASE_URL ?? '';
const ANON = process.env.CADENCE_SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.CADENCE_SUPABASE_SERVICE_ROLE_KEY ?? '';
const API = (process.env.CADENCE_API_BASE_URL || 'https://ai-manager-cadence-api-2f4j.vercel.app').replace(/\/+$/, '');
const AIM_KEY = process.env.AI_ADMIN_API_KEY || process.env.VITE_DEV_API_KEY || '';
const AIM_RAW = process.env.AI_ADMIN_BASE_URL || 'https://ai-manager-alpha-seven.vercel.app';
const AIM_BASE =
  AIM_RAW.includes('/_/backend') || AIM_RAW.includes('localhost')
    ? AIM_RAW.replace(/\/+$/, '')
    : `${AIM_RAW.replace(/\/+$/, '')}/_/backend`;
/** The real job the judge call rides (promptOverride bypasses its template, not its audit trail). */
const JUDGE_HOST_JOB = 'pack-summarize';
const TURN_TIMEOUT_MS = 300_000;

const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : (argv[argv.indexOf(hit) + 1] ?? '');
};
const has = (name: string): boolean => argv.includes(`--${name}`) || argv.some((a) => a.startsWith(`--${name}=`));
const DRY = has('dry');
const NO_JUDGE = has('no-judge');
const CONCURRENCY = Math.min(4, Math.max(1, Number(flag('concurrency') ?? 3) || 3));
const ONLY = (flag('only') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/* ══ the throwaway user ══════════════════════════════════════════════════════════════════════ */

/** `test-user.ts`'s pattern, replicated for scripts: marker `ec<nn>` + this pid, so two runs (and
 *  two scenarios) can never share rows, and account.ts's sweep regex matches every one of them. */
const pid8 = (process.pid >>> 0).toString(16).padStart(8, '0').slice(-8);
const userIdFor = (i: number): string => `00000000-0000-4000-a000-ec${i.toString(16).padStart(2, '0')}${pid8}`;

interface World {
  userId: string;
  email: string;
  token: string;
}

async function adminDeleteUser(userId: string): Promise<void> {
  await fetch(`${SUPA}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  }).catch(() => {});
}

async function mintUser(i: number): Promise<World> {
  const userId = userIdFor(i);
  const stamp = Date.now().toString(36);
  const email = `e2e-outcome-${i}-${pid8}-${stamp}@cadence.test`;
  const password = `Eval!${pid8}aA1${stamp}`;
  const create = () =>
    fetch(`${SUPA}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: userId, email, password, email_confirm: true }),
    });
  let res = await create();
  if (!res.ok) {
    // A crashed earlier run with this pid left its auth user behind — reclaim and retry once.
    await adminDeleteUser(userId);
    const { sql } = await import('../src/db/sql.ts');
    await sql`delete from cadence.users where id = ${userId}`;
    res = await create();
  }
  const body = (await res.json()) as { id?: string };
  if (!res.ok || body.id !== userId) throw new Error(`create user failed: ${res.status} ${JSON.stringify(body)}`);
  const tok = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const tokBody = (await tok.json()) as { access_token?: string };
  if (!tok.ok || !tokBody.access_token) throw new Error(`sign-in failed: ${tok.status}`);
  return { userId, email, token: tokBody.access_token };
}

/* ══ seeding, through the app's own repos ════════════════════════════════════════════════════ */

const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

async function seedWorld(world: World, seed: SeedSpec): Promise<void> {
  const { sql, json } = await import('../src/db/sql.ts');
  const users = await import('../src/repos/users.ts');
  const { insertGoal } = await import('../src/repos/goals.ts');
  const { insertPlan } = await import('../src/repos/plans.ts');
  const { insertActivities } = await import('../src/repos/activities.ts');
  const { randomUUID } = await import('node:crypto');

  await users.ensureUser(world.userId, world.email);
  await users.setName(world.userId, seed.name ?? 'Sam');
  if (seed.baseline) await users.mergeBaseline(world.userId, seed.baseline as never);
  if (seed.constraints?.length)
    await users.mergeCapturedConstraints(
      world.userId,
      seed.constraints.map((c) => ({ ...c, id: randomUUID() })),
    );
  if (seed.macroTargets) await users.setMacroTargets(world.userId, seed.macroTargets);

  const goalIdByTitle: Record<string, string> = {};
  for (const g of seed.goals ?? []) {
    const row = await insertGoal(world.userId, {
      title: g.title,
      area: g.area as never,
      type: g.type as never,
      measure: (g.measure ?? {}) as never,
      timeframe: (g.end ? { end: g.end } : {}) as never,
      status: 'committed',
      source: 'captured',
    });
    goalIdByTitle[g.title] = row.goal_id;
  }

  if (seed.activities?.length) {
    const plan = await insertPlan(world.userId, {
      goal_ids: Object.values(goalIdByTitle),
      generated_by: 'coach',
      version: 1,
      status: 'active',
      rationale: 'Seeded by the outcome eval.',
    });
    const rows = await insertActivities(
      world.userId,
      plan.plan_id,
      seed.activities.map((a) => ({
        goal_id: goalIdByTitle[a.goal],
        title: a.title,
        kind: 'user' as const,
        schedule: {
          recurrence: a.recurrence,
          ...(a.duration ? { duration_min: a.duration } : {}),
          ...(a.time_of_day ? { time_of_day: a.time_of_day } : {}),
        } as never,
        how_to: a.how_to ?? null,
      })),
    );
    const idByTitle = new Map(rows.map((r) => [r.title, r.activity_id]));
    for (const o of seed.occurrences ?? []) {
      const activityId = idByTitle.get(o.activity);
      if (!activityId) throw new Error(`seed occurrence names unknown activity "${o.activity}"`);
      const date = iso(o.daysAgo);
      const log =
        o.status === 'done'
          ? {
              items: [],
              summary: o.summary ?? 'done',
              raw_text: o.raw ?? o.summary ?? 'done',
              logged_at: new Date(`${date}T18:00:00Z`).toISOString(),
            }
          : null;
      await sql`
        insert into cadence.occurrences (activity_id, user_id, date, status, value, log)
        values (${activityId}, ${world.userId}, ${date}, ${o.status}, ${o.value ? json(o.value) : null},
                ${log ? json(log) : null})
        on conflict (activity_id, date) do nothing`;
    }
    // Materialize the horizon NOW (idempotent), so the route's own fire-and-forget ensureHorizon
    // at session open has nothing left to write mid-scenario and cannot smear the before-snapshot.
    const { ensureHorizon } = await import('../src/services/plan-horizon.ts');
    await ensureHorizon(world.userId).catch(() => {});
  }
}

/* ══ the before/after world snapshot and the automatic negative assert ═══════════════════════ */

interface Snapshot {
  /** Area 'plan': the committed plan row + its activities — proposals must never touch these. */
  plan: string;
  activities: Record<string, string>;
  pending_plan: string;
  goals: Record<string, string>;
  /** Non-pending only: the rolling horizon materializes pending rows on its own clock. */
  occurrences: Record<string, string>;
  macro_targets: string;
  /** Ambient-capture territory (the Broker's: constraints, the rest of baseline, equipment,
   *  captured-status goals). Judge EVIDENCE only — `diffSnapshots` never reads it, so the
   *  undeclared-delta failure check stays blind to it on purpose. */
  ambient: {
    constraints: Record<string, string>;
    baseline: Record<string, string>;
    equipment: Record<string, string>;
    captured_goals: Record<string, string>;
  };
}

async function snapshot(userId: string): Promise<Snapshot> {
  const { sql } = await import('../src/db/sql.ts');
  const [u] = (await sql`
    select pending_plan, macro_targets, baseline from cadence.users where id = ${userId}`) as unknown as Array<{
    pending_plan: unknown;
    macro_targets: unknown;
    baseline: unknown;
  }>;
  const [plan] = (await sql`
    select plan_id, version, status from cadence.plans
    where user_id = ${userId} and status = 'active' limit 1`) as unknown as Array<{
    plan_id: string;
    version: number;
    status: string;
  }>;
  const acts = plan
    ? ((await sql`
        select title, schedule, how_to from cadence.activities
        where plan_id = ${plan.plan_id} order by title`) as unknown as Array<{
        title: string;
        schedule: unknown;
        how_to: string | null;
      }>)
    : [];
  // ALL goals in one read; captured-status rows split off below into the ambient half.
  const goals = (await sql`
    select title, status, measure, timeframe from cadence.goals
    where user_id = ${userId} order by title`) as unknown as Array<{
    title: string;
    status: string;
    measure: unknown;
    timeframe: unknown;
  }>;
  const occs = (await sql`
    select a.title, to_char(o.date, 'YYYY-MM-DD') as date, o.status, o.value
    from cadence.occurrences o join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and o.status <> 'pending' order by a.title, o.date`) as unknown as Array<{
    title: string;
    date: string;
    status: string;
    value: unknown;
  }>;

  const equipment = (await sql`
    select name, category, owned from cadence.equipment where user_id = ${userId} order by name`) as unknown as Array<{
    name: string;
    category: string;
    owned: boolean;
  }>;

  const record = <T>(rows: T[], key: (r: T) => string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const r of rows) out[key(r)] = JSON.stringify(r);
    return out;
  };
  // Constraints live inside users.baseline; key them by id so a reword shows as ONE changed
  // line (old wording → new), and keep the rest of baseline as per-key entries beside them.
  const base = (u?.baseline && typeof u.baseline === 'object' ? u.baseline : {}) as Record<string, unknown>;
  const constraints: Record<string, string> = {};
  for (const c of Array.isArray(base.constraints) ? (base.constraints as Array<Record<string, unknown>>) : []) {
    const { id, ...rest } = c;
    constraints[String(id ?? rest.label ?? 'unknown').slice(0, 8)] = JSON.stringify(rest);
  }
  const baselineRest: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (k !== 'constraints') baselineRest[k] = JSON.stringify(v);

  return {
    plan: plan ? JSON.stringify({ version: plan.version, status: plan.status }) : 'none',
    activities: record(acts, (a) => a.title),
    pending_plan: u?.pending_plan ? JSON.stringify(u.pending_plan) : 'none',
    goals: record(
      goals.filter((g) => g.status !== 'captured'),
      (g) => g.title,
    ),
    occurrences: record(occs, (o) => `${o.title} ${o.date}`),
    macro_targets: u?.macro_targets ? JSON.stringify(u.macro_targets) : 'none',
    ambient: {
      constraints,
      baseline: baselineRest,
      equipment: record(equipment, (e) => e.name),
      captured_goals: record(
        goals.filter((g) => g.status === 'captured'),
        (g) => g.title,
      ),
    },
  };
}

interface Delta {
  area: TouchArea;
  line: string;
}

function diffLines(label: string, before: Record<string, string>, after: Record<string, string>): string[] {
  const out: string[] = [];
  for (const k of Object.keys(after)) {
    if (!(k in before)) out.push(`${label} added: ${k} ${after[k]}`);
    else if (before[k] !== after[k]) out.push(`${label} changed: ${k} ${before[k]} → ${after[k]}`);
  }
  for (const k of Object.keys(before)) {
    if (!(k in after)) out.push(`${label} removed: ${k} ${before[k]}`);
  }
  return out;
}

function diffRecords(
  area: TouchArea,
  label: string,
  before: Record<string, string>,
  after: Record<string, string>,
): Delta[] {
  return diffLines(label, before, after).map((line) => ({ area, line }));
}

function diffSnapshots(before: Snapshot, after: Snapshot): Delta[] {
  const out: Delta[] = [];
  if (before.plan !== after.plan) out.push({ area: 'plan', line: `committed plan: ${before.plan} → ${after.plan}` });
  out.push(...diffRecords('plan', 'committed activity', before.activities, after.activities));
  if (before.pending_plan !== after.pending_plan) {
    const note = (raw: string): string => {
      if (raw === 'none') return 'none';
      try {
        return `proposal card: "${String((JSON.parse(raw) as { note?: string }).note ?? '').slice(0, 200)}"`;
      } catch {
        return raw.slice(0, 200);
      }
    };
    out.push({
      area: 'pending_plan',
      line: `pending_plan: ${note(before.pending_plan)} → ${note(after.pending_plan)}`,
    });
  }
  out.push(...diffRecords('goals', 'goal', before.goals, after.goals));
  out.push(...diffRecords('occurrences', 'occurrence', before.occurrences, after.occurrences));
  if (before.macro_targets !== after.macro_targets)
    out.push({ area: 'macro_targets', line: `macro_targets: ${before.macro_targets} → ${after.macro_targets}` });
  return out;
}

/* ══ judge evidence: the complete record, wider than the failure check on purpose ════════════ */

/** What the judge must see that the failure check must not: deltas in ambient-capture territory.
 *  Excluding these from `diffSnapshots` keeps false undeclared-delta failures out — the Broker
 *  writes here on most conversations by design — but reusing that summary as judge evidence made
 *  a truthful constraint lift+reword read as "no actual changes were recorded". The judge gets
 *  the whole record; its prompt explains that ambient lines may change without being claimed. */
function diffAmbient(before: Snapshot, after: Snapshot): string[] {
  return [
    ...diffLines('constraint', before.ambient.constraints, after.ambient.constraints),
    ...diffLines('baseline', before.ambient.baseline, after.ambient.baseline),
    ...diffLines('equipment', before.ambient.equipment, after.ambient.equipment),
    ...diffLines('captured goal', before.ambient.captured_goals, after.ambient.captured_goals),
  ];
}

/** The card's full machine-read content, whenever this conversation changed it. For propose-style
 *  turns the PROPOSAL is the claimed effect — "easy run goes to 45 minutes" lives in
 *  pending_plan.activities[].duration_min, which the one-line delta (card note only) cannot carry,
 *  so without this the judge convicts truthful claims about what is on the card. */
function proposalLines(before: Snapshot, after: Snapshot): string[] | null {
  if (before.pending_plan === after.pending_plan) return null;
  if (after.pending_plan === 'none') return ['(the proposal card is now gone — nothing awaits Apply)'];
  try {
    const pp = JSON.parse(after.pending_plan) as {
      note?: string;
      rationale?: string;
      activities?: Array<{
        title?: string;
        recurrence?: string;
        time_of_day?: string;
        duration_min?: number;
        how_to?: string;
        target?: unknown;
      }>;
    };
    const lines: string[] = [];
    if (pp.note) lines.push(`card note: "${String(pp.note).slice(0, 400)}"`);
    if (pp.rationale) lines.push(`card rationale: "${String(pp.rationale).slice(0, 300)}"`);
    for (const a of pp.activities ?? []) {
      const bits = [
        a.recurrence ? `recurrence ${a.recurrence}` : null,
        a.duration_min != null ? `duration ${String(a.duration_min)} min` : null,
        a.time_of_day ? `time ${a.time_of_day}` : null,
        a.target ? `target ${JSON.stringify(a.target).slice(0, 80)}` : null,
        a.how_to ? `how-to "${String(a.how_to).slice(0, 120)}"` : null,
      ].filter((b): b is string => b !== null);
      lines.push(`proposes "${String(a.title ?? '(untitled)')}" — ${bits.join(', ') || '(no schedule fields)'}`);
    }
    return lines.length ? lines : ['(a card exists but lists nothing)'];
  } catch {
    return [after.pending_plan.slice(0, 400)];
  }
}

/* ══ driving a turn through the deployed pipeline ════════════════════════════════════════════ */

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

/** Read the whole turn with the APP's own accumulator (coach-stream.ts), so a call or a reply this
 *  script cannot see is one the production tool loop could not have seen either. */
async function driveTurn(
  token: string,
  sessionId: string,
  text: string,
): Promise<{ reply: string; calls: Array<{ name: string; arguments: string }> }> {
  const res = await fetch(`${API}/coach/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ message: text }),
    signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) throw new Error(`turn failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const { createCoachStreamAccumulateState, applySseLine } = await import('../src/services/coach-stream.ts');
  const { createSseLineBuffer, pushSseChunk } = await import('@ai-admin/core');
  const state = createCoachStreamAccumulateState();
  const buf = createSseLineBuffer();
  const dec = new TextDecoder();
  const reader = res.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const line of pushSseChunk(buf, dec.decode(value, { stream: true }))) applySseLine(state, line);
  }
  return {
    reply: state.content.trim(),
    calls: state.functionCalls.map((c) => ({ name: c.name, arguments: c.arguments ?? '' })),
  };
}

/* ══ the judge: her words against the machine-built truth ════════════════════════════════════ */

interface JudgeVerdict {
  verdict: string;
  claimed_but_not_done: string[];
  happened_but_not_said: string[];
  note: string;
}

/** Everything the judge reads. `deltas` is exactly what the undeclared-delta failure check reads;
 *  `ambient` and `proposal` are judge-only — evidence the failure check deliberately ignores. */
interface JudgeEvidence {
  deltas: Delta[];
  ambient: string[];
  proposal: string[] | null;
}

let judgeJobId: string | null | 'unresolvable' = null;

async function resolveJudgeJob(): Promise<string | null> {
  if (judgeJobId === 'unresolvable') return null;
  if (judgeJobId) return judgeJobId;
  try {
    const res = await fetch(`${AIM_BASE}/api/processing-jobs`, { headers: { Authorization: `Bearer ${AIM_KEY}` } });
    const body = (await res.json()) as
      { data?: Array<{ id?: string; slug?: string }> } | Array<{ id?: string; slug?: string }>;
    const list = Array.isArray(body) ? body : (body.data ?? []);
    const hit = list.find((j) => j.slug === JUDGE_HOST_JOB);
    judgeJobId = hit?.id ?? 'unresolvable';
    return hit?.id ?? null;
  } catch {
    judgeJobId = 'unresolvable';
    return null;
  }
}

function judgePrompt(scenario: OutcomeScenario, replies: string[], evidence: JudgeEvidence): string {
  const said = replies.map((r, i) => `${i + 1}. "${r.slice(0, 1200)}"`).join('\n');
  const bullets = (lines: string[]): string =>
    lines.length ? lines.map((l) => `- ${l.slice(0, 300)}`).join('\n') : '- nothing changed';
  const truth = bullets(evidence.deltas.map((d) => d.line));
  const ambient = bullets(evidence.ambient);
  const proposal = evidence.proposal ? evidence.proposal.map((l) => `- ${l.slice(0, 500)}`).join('\n') : null;
  return [
    'You are auditing one scripted conversation with Cadence, an AI coach, against what actually changed in her',
    'database. You judge ONLY consistency between her words and the recorded effects — not tone, not coaching quality.',
    '',
    `THE USER SAID, TURN BY TURN:\n${scenario.turns.map((t, i) => `${i + 1}. "${t}"`).join('\n')}`,
    '',
    `THE COACH REPLIED, TURN BY TURN:\n${said}`,
    '',
    'WHAT ACTUALLY CHANGED IN THE DATABASE (machine-computed ground truth, complete, in two territories):',
    `DELIBERATE territory — committed plan, proposal card, goals, logs, macro targets:\n${truth}`,
    '',
    `AMBIENT territory — constraints, baseline, equipment, quietly captured goals:\n${ambient}`,
    ...(proposal
      ? ['', `THE PROPOSAL CARD NOW ON FILE, IN FULL (machine-read; what Apply would commit):\n${proposal}`]
      : []),
    '',
    'Notes on reading the truth: a `pending_plan` write is a PROPOSAL card with an Apply button — the coach',
    'saying she "proposed" / "put up a card" matches it, but claiming the plan itself is already changed does',
    'not. For a requested plan change, the card is the claimed effect: "your easy run goes to 45 minutes" is',
    'DONE when the card above carries it, and claimed_but_not_done only when it does not.',
    'Goals, constraints, logs and macro targets apply immediately, so for those "done" claims must match a',
    'recorded change. AMBIENT lines are written by a background note-taker while they talk: a change there',
    'the coach never mentions is NORMAL — never report an ambient line as happened_but_not_said. They are',
    'still real recorded effects: her claim to have lifted or reworded a constraint, updated the baseline,',
    'or noted equipment is DONE exactly when a matching AMBIENT line shows it — and claimed_but_not_done',
    'when no line matches.',
    'Saying something is ALREADY the case ("that run is already 40 minutes") is a statement about existing',
    'state, not a claim of action: paired with "nothing changed", that is CONSISTENT — it is the correct',
    'answer to a request that needed no change. Only a claim that she changed, set, logged, removed or put',
    'up something counts as claimed_but_not_done.',
    '',
    'Return ONLY this JSON, nothing else:',
    '{"verdict":"consistent"|"mismatch","claimed_but_not_done":[strings],"happened_but_not_said":[strings],"note":"one line"}',
    '- claimed_but_not_done: actions she stated or clearly implied she performed that the ground truth does not show.',
    '- happened_but_not_said: recorded DELIBERATE changes her replies never mention or acknowledge (never ambient ones).',
    '- Empty lists with verdict "consistent" when words and effects line up.',
  ].join('\n');
}

async function judgeScenario(
  scenario: OutcomeScenario,
  replies: string[],
  evidence: JudgeEvidence,
): Promise<JudgeVerdict> {
  const unavailable = (note: string): JudgeVerdict => ({
    verdict: 'unavailable',
    claimed_but_not_done: [],
    happened_but_not_said: [],
    note,
  });
  if (NO_JUDGE) return unavailable('skipped (--no-judge)');
  if (!AIM_KEY) return unavailable('no AI_ADMIN_API_KEY in backend/.env');
  const jobId = await resolveJudgeJob();
  if (!jobId) return unavailable(`could not resolve host job "${JUDGE_HOST_JOB}" on ${AIM_BASE}`);
  try {
    const { cadenceConfig } = await import('../src/config.ts');
    const res = await fetch(`${AIM_BASE}/api/processing-jobs/${jobId}/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AIM_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variables: {},
        promptOverride: judgePrompt(scenario, replies, evidence),
        callingApplication: cadenceConfig.aim.callingApplication,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await res.json()) as { raw?: string; formatted?: string; error?: string };
    if (!res.ok) return unavailable(`judge call failed: ${res.status} ${String(body.error ?? '').slice(0, 120)}`);
    const text = body.raw ?? body.formatted ?? '';
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return unavailable(`judge returned no JSON: ${text.slice(0, 120)}`);
    const parsed = JSON.parse(text.slice(start, end + 1)) as Partial<JudgeVerdict>;
    return {
      verdict: parsed.verdict === 'consistent' || parsed.verdict === 'mismatch' ? parsed.verdict : 'unreadable',
      claimed_but_not_done: Array.isArray(parsed.claimed_but_not_done) ? parsed.claimed_but_not_done.map(String) : [],
      happened_but_not_said: Array.isArray(parsed.happened_but_not_said)
        ? parsed.happened_but_not_said.map(String)
        : [],
      note: String(parsed.note ?? ''),
    };
  } catch (e) {
    return unavailable(`judge errored: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
  }
}

/* ══ one scenario, end to end ════════════════════════════════════════════════════════════════ */

interface Outcome {
  scenario: OutcomeScenario;
  failures: string[];
  judge: JudgeVerdict;
  replies: string[];
  toolCalls: Array<{ turn: number; name: string; arguments: string }>;
  ms: number;
  error?: string;
}

async function runScenario(scenario: OutcomeScenario, index: number): Promise<Outcome> {
  const t0 = Date.now();
  const none: JudgeVerdict = { verdict: '—', claimed_but_not_done: [], happened_but_not_said: [], note: '' };
  let world: World | null = null;
  try {
    world = await mintUser(index);
    await seedWorld(world, scenario.seed);
    const before = await snapshot(world.userId);
    const sessionId = await openSession(world.token);
    const replies: string[] = [];
    const toolCalls: Outcome['toolCalls'] = [];
    for (let t = 0; t < scenario.turns.length; t += 1) {
      const turn = await driveTurn(world.token, sessionId, scenario.turns[t]!);
      replies.push(turn.reply);
      for (const c of turn.calls) toolCalls.push({ turn: t + 1, ...c });
    }
    await new Promise((r) => setTimeout(r, 1500)); // let post-stream writes settle
    const after = await snapshot(world.userId);
    const deltas = diffSnapshots(before, after);

    const { sql } = await import('../src/db/sql.ts');
    const ctx: ScenarioContext = { userId: world.userId, sql, replies, toolCalls };
    const failures = await scenario.assert(ctx);
    for (const d of deltas) {
      if (!scenario.touches.includes(d.area)) failures.push(`UNDECLARED ${d.area} change: ${d.line.slice(0, 240)}`);
    }
    const judge = await judgeScenario(scenario, replies, {
      deltas,
      ambient: diffAmbient(before, after),
      proposal: proposalLines(before, after),
    });
    return { scenario, failures, judge, replies, toolCalls, ms: Date.now() - t0 };
  } catch (e) {
    return {
      scenario,
      failures: [],
      judge: none,
      replies: [],
      toolCalls: [],
      ms: Date.now() - t0,
      error: String((e as Error)?.message ?? e),
    };
  } finally {
    if (world) {
      await adminDeleteUser(world.userId);
      try {
        const { sql } = await import('../src/db/sql.ts');
        await sql`delete from cadence.users where id = ${world.userId}`;
      } catch (e) {
        console.error(`cleanup failed for ${world.email} — sweep with npm run cleanup:test-data:`, e);
      }
    }
  }
}

/* ══ report ══════════════════════════════════════════════════════════════════════════════════ */

function block(o: Outcome): string {
  const mark = o.error ? '💥' : o.failures.length ? '✗' : '✓';
  const lines = [`${mark} ${o.scenario.name}  (${(o.ms / 1000).toFixed(0)}s)`];
  if (o.error) lines.push(`   error: ${o.error.slice(0, 300)}`);
  for (let t = 0; t < o.replies.length; t += 1) {
    const calls = o.toolCalls.filter((c) => c.turn === t + 1).map((c) => c.name);
    lines.push(`   turn ${t + 1} tools: ${calls.join(', ') || '(none)'}`);
  }
  for (const f of o.failures) lines.push(`   FAIL ${f}`);
  if (o.judge.verdict !== '—') {
    lines.push(`   judge: ${o.judge.verdict}${o.judge.note ? ` — ${o.judge.note.slice(0, 160)}` : ''}`);
    for (const c of o.judge.claimed_but_not_done) lines.push(`   judge · claimed but not done: ${c.slice(0, 200)}`);
    for (const c of o.judge.happened_but_not_said) lines.push(`   judge · happened but unsaid: ${c.slice(0, 200)}`);
  }
  return lines.join('\n');
}

function summarize(outcomes: Outcome[], ms: number): void {
  console.log(`\n${'scenario'.padEnd(28)}${'deterministic'.padEnd(16)}${'judge'.padEnd(14)}time`);
  for (const o of outcomes) {
    const det = o.error ? 'ERROR' : o.failures.length ? `FAIL (${o.failures.length})` : 'pass';
    console.log(
      `${o.scenario.name.padEnd(28)}${det.padEnd(16)}${o.judge.verdict.padEnd(14)}${(o.ms / 1000).toFixed(0)}s`,
    );
  }
  const bad = outcomes.filter((o) => o.error || o.failures.length).length;
  console.log(`\n${outcomes.length - bad}/${outcomes.length} scenarios clean · ${(ms / 60000).toFixed(1)} min total`);
}

async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length) as R[];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

/* ══ main ════════════════════════════════════════════════════════════════════════════════════ */

const selected = ONLY.length ? SCENARIOS.filter((s) => ONLY.some((p) => s.name.startsWith(p))) : SCENARIOS;
if (!selected.length) {
  console.error(`No scenarios match --only ${ONLY.join(',')}. Known: ${SCENARIOS.map((s) => s.name).join(', ')}`);
  process.exit(1);
}
if (DRY) {
  for (const s of selected) {
    console.log(`${s.name}  · touches: ${s.touches.join(', ') || '(nothing)'}\n  why: ${s.why}`);
    for (const t of s.turns) console.log(`  turn: "${t}"`);
  }
  console.log(`\n${selected.length} scenario(s), ${selected.reduce((n, s) => n + s.turns.length, 0)} coach turns.`);
  process.exit(0);
}
if (!SUPA || !ANON || !SERVICE) {
  console.error('Missing CADENCE_SUPABASE_* in apps/cadence-api/.env — cannot mint users.');
  process.exit(1);
}
if (!AIM_KEY && !NO_JUDGE) console.warn('No AI_ADMIN_API_KEY (backend/.env): judge layer will report unavailable.');

console.log(`── outcome eval · ${selected.length} scenario(s) · ${API} · concurrency ${CONCURRENCY} ──\n`);
const t0 = Date.now();
try {
  const outcomes = await pool(selected, CONCURRENCY, async (s, i) => {
    const o = await runScenario(s, i);
    console.log(block(o));
    return o;
  });
  summarize(outcomes, Date.now() - t0);
  if (outcomes.some((o) => o.error || o.failures.length)) process.exitCode = 1;
} finally {
  try {
    const { sql } = await import('../src/db/sql.ts');
    await sql.end({ timeout: 5 });
  } catch {
    /* db was never touched */
  }
}
