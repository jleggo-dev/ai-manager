/**
 * CONVERSATION REPLAY EVAL — the owner's 2026-08-29 piano conversation, turn for turn, against
 * the deployed harness. The first MULTI-TURN eval: `eval-tool-selection.ts` is deliberately
 * first-turns-only and its own header names what it therefore cannot see ("the headline failure
 * of 2026-08-16 needed a history"). This script is that missing shape, built from the one
 * conversation that has already cost us a feature: ai-admin chat `773f61a1`, where "select from
 * the pieces I already know" had nowhere to look and nine typed pieces froze into one plan
 * sentence. Owner ruling 2026-08-30: handed the list, she must store it — turn 7 is that ruling
 * as an assertion.
 *
 * MANUAL GATE, NOT CI — same posture as the tool-selection eval, for the same reasons: it talks
 * to prod, costs real money, and **measures the DEPLOYED api, not your working tree**. Merge,
 * wait for Vercel, sync jobs, then run:
 *
 *   node --import tsx apps/cadence-api/scripts/eval-conversation-replay.ts
 *
 * ONE session, turns in order — history is the thing under test, so there is no concurrency and
 * no per-case fresh session. Turns are the owner's words verbatim (typos and all); only the
 * seeded world is synthetic, rebuilt to match his pre-conversation state (meditation daily,
 * piano Wed/Fri/Sat at 45, the four goals). The real conversation's last three turns are NOT
 * replayed: they were the owner hand-working around the missing store ("each day it has to
 * rotate", "you choose the song"), and with repertoire live the rotation belongs to
 * prescribe-session, so a faithful replay of the workaround would assert the bug back in.
 *
 * Scoring is the tool-selection eval's contract (expect / allow / forbid + arg checks), credited
 * via /coach/trace when the Broker prefetched a read. A turn may also declare `judgement: true` —
 * asking a good clarifying question is as correct as acting, so only `forbid` is scored there.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { API, createUser, missingEnv, signIn, tearDown, type World } from './eval-tool-selection-world.ts';

const TURN_TIMEOUT_MS = 180_000;

interface ReplayTurn {
  id: string;
  turn: string;
  expect: string[];
  allow?: string[];
  forbid?: string[];
  /** True = a clarifying question is as correct as acting; only `forbid` is scored. */
  judgement?: boolean;
  args?: { tool: string; check: (a: Record<string, unknown>) => string | null };
  why: string;
}

const DOSSIER = [
  'get_identity',
  'get_objectives',
  'get_active_plan',
  'get_consistency',
  'get_constraints',
  'get_weight',
  'get_goal_progress',
  'get_recent_logs',
  'get_repertoire',
  'get_practice_totals',
];

const str = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase() : '');

/** The owner's turns, verbatim from chat_messages of session 773f61a1 (2026-08-29 22:01–22:26Z). */
const TURNS: ReplayTurn[] = [
  {
    id: 'R1',
    turn: 'I want to modify my plan - for now I’d like to remove the meditation pieces and I want to focus more on the piano playing. My weekly piano class is Saturday so I don’t need practice on that day.',
    expect: ['propose_plan_change'],
    allow: [...DOSSIER, 'update_constraint'],
    why: 'The opening edit. In the real run she needed three calls (invented a "drop" action first); the card must go up.',
  },
  {
    id: 'R2',
    turn: 'I also want to modify the underlying activities for piano practice. My overarching goal is to finish learning Suzuki book 2 and also learn Frankie and Johnnie.',
    expect: ['propose_plan_change'],
    allow: [...DOSSIER, 'update_goal', 'update_repertoire'],
    why: 'A content rework; naming Frankie and Johnnie as new working material may reasonably also be recorded.',
  },
  {
    id: 'R3',
    turn: 'In Suzuki book 2 I’m on melody',
    expect: ['update_repertoire'],
    allow: [...DOSSIER, 'propose_plan_change'],
    args: {
      tool: 'update_repertoire',
      check: (a) => {
        const items = Array.isArray(a.items) ? (a.items as Array<Record<string, unknown>>) : [];
        const melody = items.find((i) => /melody/i.test(str(i.label)));
        if (!melody) return 'no item recording Melody';
        return str(melody.status) === 'working' ? null : `Melody status "${String(melody.status)}", wanted working`;
      },
    },
    why: 'A bare fact about where he is. In the real run it went only into plan text; now it is repertoire state.',
  },
  {
    id: 'R4',
    turn: 'My teacher suggested the following for a 30 minute practice spot\n5 mins site reading\n5 mins skills and chords — add metronome - speed 60\n2-3 mins a piece that I know \n5-10 mins of review \n5-10 mins on new piece - melody',
    expect: [],
    judgement: true,
    allow: [...DOSSIER, 'propose_plan_change'],
    why: 'In the real run she caught the 45-vs-30 mismatch and asked — that was RIGHT. Acting directly is also fine.',
  },
  {
    id: 'R5',
    turn: 'trim piano sessions down to 30 minutes to match',
    expect: ['propose_plan_change'],
    allow: [...DOSSIER],
    args: {
      tool: 'propose_plan_change',
      check: (a) => {
        const edits = Array.isArray(a.edits) ? (a.edits as Array<Record<string, unknown>>) : [];
        return edits.some((e) => e.duration_min === 30 || str(e.action) === 'resize')
          ? null
          : 'no resize-to-30 edit in the call';
      },
    },
    why: 'The pick he tapped. A resize, nothing more.',
  },
  {
    id: 'R6',
    turn: 'Can you select from the pieces I already know and mix and match them? Assume I know the earlier songs from Suzuki book 2 - those are good practice pieces',
    expect: ['get_repertoire'],
    allow: [...DOSSIER, 'propose_plan_change', 'update_repertoire'],
    why: 'THE turn the feature exists for. She must LOOK first; the store is empty, so asking for the list after reading is the ideal shape — asking without reading was the old bug.',
  },
  {
    id: 'R7',
    turn: 'All of them - maybe you can mix and match over the coming weeks: Écossaise by J.N. HummelA Short Story by H. LichnerThe Happy Farmer (from Album for the Young, Op. 68, No. 10) by R. SchumannMinuet in G Major, BWV 822 by J.S. BachMinuet in G Major (from Notebook for Anna Magdalena Bach) by AnonymousMinuet in G Minor, BWV 822 by J.S. BachCradle Song, Op. 13, No. 2 by C.M. von WeberArietta by W.A. MozartMelody by R. Schumann',
    expect: ['update_repertoire'],
    allow: [...DOSSIER, 'propose_plan_change'],
    args: {
      tool: 'update_repertoire',
      check: (a) => {
        const items = Array.isArray(a.items) ? (a.items as Array<Record<string, unknown>>) : [];
        if (items.length < 5) return `only ${items.length} items stored of the nine listed`;
        const learned = items.filter((i) => str(i.status) === 'learned');
        return learned.length ? `${learned.length} backfilled pieces marked "learned" — that invents accomplishments` : null;
      },
    },
    why: 'The ruling turn (owner, 2026-08-30): "she should know she has to store it." Nine pieces → known, quietly.',
  },
];

interface Observed {
  calls: Array<{ name?: string; arguments?: string }>;
  reply: string;
  model: string | null;
}

async function readTurn(body: ReadableStream<Uint8Array>): Promise<Observed> {
  const { createCoachStreamAccumulateState, applySseLine } = await import('../src/services/coach-stream.ts');
  const { createSseLineBuffer, pushSseChunk } = await import('@ai-admin/core');
  const state = createCoachStreamAccumulateState();
  const buf = createSseLineBuffer();
  const dec = new TextDecoder();
  const reader = body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const line of pushSseChunk(buf, dec.decode(value, { stream: true }))) applySseLine(state, line);
  }
  return { calls: state.functionCalls, reply: state.content, model: state.model };
}

async function prefetchedFns(token: string): Promise<string[]> {
  try {
    const res = await fetch(`${API}/coach/trace`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return [];
    const body = (await res.json()) as { turnSelect?: { calls?: Array<{ fn?: string }> } | null };
    return (body.turnSelect?.calls ?? []).map((c) => String(c.fn)).filter(Boolean);
  } catch {
    return [];
  }
}

const parseArgs = (raw: string | undefined): Record<string, unknown> => {
  try {
    const p = raw?.trim() ? (JSON.parse(raw) as unknown) : {};
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** The pre-conversation world: his committed plan the evening of 2026-08-29, reduced to what the
 *  turns talk about. Titles are load-bearing — the edit tools match commitments by title. */
async function seedPianoWorld(userId: string): Promise<void> {
  const { sql } = await import('../src/db/sql.ts');
  const { setName, mergeCapturedConstraints, mergeBaseline } = await import('../src/repos/users.ts');
  const { insertGoal } = await import('../src/repos/goals.ts');
  const { insertPlan } = await import('../src/repos/plans.ts');
  const { insertActivities } = await import('../src/repos/activities.ts');
  const { randomUUID } = await import('node:crypto');

  await setName(userId, 'Sam');
  await mergeBaseline(userId, {
    weight_kg: { current: 88.5, start: 90, source: 'manual', updated_at: new Date().toISOString().slice(0, 10) },
    height_cm: 170,
    sex: 'male',
  });
  await mergeCapturedConstraints(userId, [
    { id: randomUUID(), label: 'tendinitis in left knee', kind: 'physical', status: 'active', plan_around: true },
  ]);

  const goals: Array<{ title: string; area: string; type: string; brief?: string }> = [
    { title: 'Run a Spartan Ultra Beast', area: 'movement', type: 'milestone' },
    { title: 'Lose weight', area: 'nourishment', type: 'recurring' },
    { title: 'Build mental resilience', area: 'mind', type: 'recurring' },
    {
      title: 'Practice piano',
      area: 'practice',
      type: 'recurring',
      brief: 'I do also try to practice piano at least three times a week maybe we can put that in the schedule as well.',
    },
  ];
  const goalIdByTitle: Record<string, string> = {};
  for (const g of goals) {
    const row = await insertGoal(userId, {
      title: g.title,
      area: g.area as never,
      type: g.type as never,
      measure: {} as never,
      timeframe: {} as never,
      status: 'committed',
      source: 'captured',
      ...(g.brief ? { brief: g.brief } : {}),
    } as never);
    goalIdByTitle[g.title] = row.goal_id;
  }

  const plan = await insertPlan(userId, {
    goal_ids: Object.values(goalIdByTitle),
    generated_by: 'coach',
    version: 1,
    status: 'active',
    rationale: 'A daily sit for resilience, piano three evenings, runs for the Ultra Beast.',
  });
  const activities = await insertActivities(userId, plan.plan_id, [
    {
      goal_id: goalIdByTitle['Build mental resilience'],
      title: 'Morning meditation sit',
      kind: 'user' as const,
      schedule: { recurrence: 'FREQ=DAILY', time_of_day: '06:30', duration_min: 10 } as never,
      how_to: null,
    },
    {
      goal_id: goalIdByTitle['Practice piano'],
      title: 'Piano practice',
      kind: 'user' as const,
      schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=WE,FR,SA', time_of_day: '19:00', duration_min: 45 } as never,
      how_to: null,
    },
    {
      goal_id: goalIdByTitle['Run a Spartan Ultra Beast'],
      title: 'Easy run',
      kind: 'user' as const,
      schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU,TH', duration_min: 40 } as never,
      how_to: null,
    },
  ]);
  for (const a of activities) {
    for (let i = 1; i <= 4; i += 1) {
      const date = new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10);
      await sql`
        insert into cadence.occurrences (activity_id, user_id, date, status)
        values (${a.activity_id}, ${userId}, ${date}, 'pending')
        on conflict (activity_id, date) do nothing`;
    }
  }
}

async function main(): Promise<void> {
  const envProblem = missingEnv();
  if (envProblem) throw new Error(envProblem);

  const stamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 14);
  const email = `e2e-replay-${stamp}@cadence.test`;
  const password = `Eval!${stamp}aA1`;
  const userId = await createUser(email, password);
  const token = await signIn(email, password);
  const world: World = { userId, email, token };
  console.log(`✓ ${email}`);

  try {
    await fetch(`${API}/plan`, { headers: { Authorization: `Bearer ${token}` } });
    await seedPianoWorld(userId);
    console.log('✓ piano world seeded: 4 goals, meditation daily + piano We/Fr/Sa 45min + easy runs');

    const open = await fetch(`${API}/coach/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'ongoing', healthAvailable: false, healthAnswered: true }),
    });
    const { sessionId } = (await open.json()) as { sessionId?: string };
    if (!open.ok || !sessionId) throw new Error(`open session failed: ${open.status}`);
    console.log(`✓ one session for all turns — history is the thing under test\n`);

    let passed = 0;
    for (const t of TURNS) {
      const t0 = Date.now();
      const res = await fetch(`${API}/coach/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ message: t.turn }),
        signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
      });
      if (!res.ok || !res.body) {
        console.log(`✗ ${t.id} — HTTP ${res.status}`);
        continue;
      }
      const obs = await readTurn(res.body);
      const prefetched = await prefetchedFns(token);
      const called = obs.calls.map((c) => String(c.name ?? ''));
      const haveOrPrefetched = new Set([...called, ...prefetched]);

      const problems: string[] = [];
      if (!t.judgement) for (const e of t.expect) if (!haveOrPrefetched.has(e)) problems.push(`missing ${e}`);
      const allowed = new Set([...(t.allow ?? []), ...t.expect]);
      for (const f of t.forbid ?? []) if (called.includes(f)) problems.push(`forbidden ${f} fired`);
      const extra = called.filter((n) => n && !allowed.has(n));
      if (extra.length) problems.push(`unexpected: ${extra.join(', ')}`);
      if (t.args) {
        const call = obs.calls.find((c) => c.name === t.args!.tool);
        if (call) {
          const problem = t.args.check(parseArgs(call.arguments));
          if (problem) problems.push(`args: ${problem}`);
        }
      }

      const ok = problems.length === 0;
      passed += ok ? 1 : 0;
      console.log(
        `${ok ? '✓' : '✗'} ${t.id} [${Math.round((Date.now() - t0) / 1000)}s] called: ${called.join(', ') || '(none)'}` +
          (ok ? '' : `\n    ${problems.join('\n    ')}`) +
          `\n    reply: ${obs.reply.slice(0, 140).replace(/\n/g, ' ')}`,
      );
      await delay(1_000); // let fire-and-forget writes land before the next turn reads them
    }
    console.log(`\n${passed}/${TURNS.length} turns clean (model answers vary — read the misses, not just the count)`);
  } finally {
    await tearDown(world);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
