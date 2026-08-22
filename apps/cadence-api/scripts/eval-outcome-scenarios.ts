/**
 * The outcome eval's cases — each one a short scripted conversation plus assertions on the
 * DATABASE afterwards. See `eval-outcomes.ts` for how they are driven; this file only says what a
 * pass looks like.
 *
 * Every scenario here is sourced from something that reached the owner's phone. The common shape:
 * the right tool was SELECTED (so `eval:tools` passed), and the OUTCOME was still wrong — dropped,
 * overwritten, padded, or claimed-without-happening. So assertions read `cadence.*` state, never
 * her prose; prose is the judge's half (also in the runner).
 *
 * A scenario declares `touches` — the areas of the world it is allowed to change. The runner
 * snapshots the world before and after and flags ANY undeclared delta automatically, so "nothing
 * else changed" is asserted for every scenario without each case writing it out. Areas dodge ambient
 * noise deliberately: captured-status goals, equipment, and baseline belong to the Broker's
 * ambient capture and are excluded from the automatic diff (they change on most conversations by
 * design); constraints are asserted explicitly where a scenario is about them.
 *
 * That exclusion belongs to the FAILURE check alone. The judge receives the complete record —
 * ambient deltas labelled as such, and the proposal card in full — because evidence hidden from
 * the judge reads as "nothing happened" and convicts truthful replies (the constraint-lift-reword
 * false mismatch of the first full run).
 */
import type { Constraint, MacroTargets, PendingPlan, PendingPlanActivity } from '@cadence/shared';

/** The app's own postgres tag, handed in by the runner after env is loaded. */
export type DbSql = (typeof import('../src/db/sql.ts'))['sql'];

/** The world areas the automatic before/after differ watches. */
export type TouchArea = 'plan' | 'pending_plan' | 'goals' | 'occurrences' | 'macro_targets';

export interface SeedGoal {
  title: string;
  area: 'movement' | 'nourishment' | 'mind' | 'practice';
  type: 'target' | 'recurring' | 'milestone';
  measure?: Record<string, unknown>;
  end?: string;
}

export interface SeedActivity {
  title: string;
  /** Which seeded goal it serves, by title. */
  goal: string;
  recurrence: string;
  duration?: number;
  time_of_day?: string;
  how_to?: string;
}

export interface SeedOccurrence {
  activity: string;
  daysAgo: number;
  status: 'done' | 'pending';
  value?: Record<string, number>;
  summary?: string;
  raw?: string;
}

export interface SeedSpec {
  name?: string;
  baseline?: Record<string, unknown>;
  constraints?: Array<Omit<Constraint, 'id'>>;
  macroTargets?: MacroTargets;
  goals?: SeedGoal[];
  /** Present ⇒ a committed (status 'active', v1) plan is created around them. */
  activities?: SeedActivity[];
  occurrences?: SeedOccurrence[];
}

export interface ScenarioContext {
  userId: string;
  sql: DbSql;
  /** Her reply per turn, in order. */
  replies: string[];
  /** Every tool call observed on the wire, for diagnostics — assert on the DB, not on these. */
  toolCalls: Array<{ turn: number; name: string; arguments: string }>;
}

export interface OutcomeScenario {
  name: string;
  /** The bug (usually dated) that earned this scenario a place. */
  why: string;
  seed: SeedSpec;
  turns: string[];
  touches: TouchArea[];
  /** Deterministic checks against the DB. Return one plain line per failure; [] is a pass. */
  assert: (ctx: ScenarioContext) => Promise<string[]>;
}

/* ══ small readers the asserts share ═════════════════════════════════════════════════════════ */

async function userRow(ctx: ScenarioContext): Promise<{
  pending_plan: PendingPlan | null;
  macro_targets: MacroTargets | null;
  baseline: { constraints?: Constraint[] } | null;
}> {
  const rows = (await ctx.sql`
    select pending_plan, macro_targets, baseline from cadence.users where id = ${ctx.userId}`) as unknown as Array<{
    pending_plan: PendingPlan | null;
    macro_targets: MacroTargets | null;
    baseline: { constraints?: Constraint[] } | null;
  }>;
  return rows[0] ?? { pending_plan: null, macro_targets: null, baseline: null };
}

/** Find one pending activity by title — exact (case-insensitive) first, containment second. */
function inPending(pp: PendingPlan | null, title: string): PendingPlanActivity | undefined {
  const q = title.trim().toLowerCase();
  const all = pp?.activities ?? [];
  return (
    all.find((a) => a.title.trim().toLowerCase() === q) ?? all.find((a) => a.title.trim().toLowerCase().includes(q))
  );
}

async function committedTitles(ctx: ScenarioContext): Promise<string[]> {
  const rows = (await ctx.sql`
    select a.title from cadence.activities a
    join cadence.plans p on p.plan_id = a.plan_id and p.status = 'active'
    where a.user_id = ${ctx.userId} order by a.title`) as unknown as Array<{ title: string }>;
  return rows.map((r) => r.title);
}

async function goalByTitle(
  ctx: ScenarioContext,
  title: string,
): Promise<{
  title: string;
  status: string;
  measure: Record<string, unknown>;
  timeframe: Record<string, unknown>;
} | null> {
  const rows = (await ctx.sql`
    select title, status, measure, timeframe from cadence.goals
    where user_id = ${ctx.userId} and lower(title) = ${title.toLowerCase()}`) as unknown as Array<{
    title: string;
    status: string;
    measure: Record<string, unknown>;
    timeframe: Record<string, unknown>;
  }>;
  return rows[0] ?? null;
}

async function occurrencesOf(
  ctx: ScenarioContext,
  activityTitle: string,
): Promise<
  Array<{ date: string; status: string; value: Record<string, number> | null; log: Record<string, unknown> | null }>
> {
  return (await ctx.sql`
    select to_char(o.date, 'YYYY-MM-DD') as date, o.status, o.value, o.log
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${ctx.userId} and lower(a.title) = ${activityTitle.toLowerCase()}
    order by o.date`) as unknown as Array<{
    date: string;
    status: string;
    value: Record<string, number> | null;
    log: Record<string, unknown> | null;
  }>;
}

const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

/* ══ the world most plan scenarios share ═════════════════════════════════════════════════════ */

const RUN_GOAL: SeedGoal = {
  title: 'Run a 10k in October',
  area: 'movement',
  type: 'target',
  measure: { target: 10, unit: 'km' },
  end: '2026-10-11',
};
const MIND_GOAL: SeedGoal = { title: 'Sit for ten minutes most mornings', area: 'mind', type: 'recurring' };

/* ══ the scenarios ═══════════════════════════════════════════════════════════════════════════ */

export const SCENARIOS: OutcomeScenario[] = [
  {
    name: 'move-then-resize',
    why:
      'Card overwrite (2026-08-17): a second propose_plan_change recomputed from the committed plan and ' +
      'silently deleted the move already on the card. Both changes must survive onto ONE proposal.',
    seed: {
      goals: [RUN_GOAL, MIND_GOAL],
      activities: [
        { title: 'Box breathing', goal: 'Sit for ten minutes most mornings', recurrence: 'FREQ=DAILY', duration: 5 },
        { title: 'Easy run', goal: 'Run a 10k in October', recurrence: 'FREQ=WEEKLY;BYDAY=TU,TH', duration: 30 },
      ],
    },
    turns: ['can we move my box breathing to just sundays?', 'great — and make my easy run 45 minutes please'],
    touches: ['pending_plan'],
    assert: async (ctx) => {
      const failures: string[] = [];
      const pp = (await userRow(ctx)).pending_plan;
      if (!pp) return ['no pending_plan was written at all — both proposals vanished'];
      const breathing = inPending(pp, 'Box breathing');
      if (!breathing) failures.push('Box breathing is missing from the proposal');
      else if (!/BYDAY=SU(?![A-Z])/.test(breathing.recurrence ?? ''))
        failures.push(
          `the move was lost: Box breathing recurrence is "${breathing.recurrence}", expected Sundays only`,
        );
      const run = inPending(pp, 'Easy run');
      if (!run) failures.push('Easy run is missing from the proposal');
      else if (run.duration_min !== 45)
        failures.push(`the resize did not land: Easy run duration_min is ${String(run.duration_min)}, expected 45`);
      const note = `${pp.note ?? ''}\n${pp.rationale ?? ''}`;
      if (!/box breathing/i.test(note) || !/easy run/i.test(note))
        failures.push(`the card's own description names only one change: "${(pp.note ?? '').slice(0, 120)}"`);
      return failures;
    },
  },

  {
    name: 'resize-noop',
    why:
      'The empty card (2026-08-17): resizing to the value already stored produced "40 min → 40 min", a ' +
      'pending plan, and an Apply button that regenerated ten sessions to change nothing. A no-change ' +
      "turn must write NO pending_plan; whether her reply admits it is the judge's half.",
    seed: {
      goals: [RUN_GOAL],
      activities: [
        { title: 'Easy run', goal: 'Run a 10k in October', recurrence: 'FREQ=WEEKLY;BYDAY=TU,TH', duration: 40 },
      ],
    },
    turns: ['make my easy run 40 minutes'],
    touches: [],
    assert: async (ctx) => {
      const pp = (await userRow(ctx)).pending_plan;
      if (pp) return [`a pending_plan was written for a no-op: "${(pp.note ?? '').slice(0, 120)}"`];
      if (!(ctx.replies[0] ?? '').trim()) return ['no reply at all'];
      return [];
    },
  },

  {
    name: 'rename-is-rework',
    why:
      'Dropped rename (2026-08-17): she called the action "rename", the filter silently discarded it ' +
      'twice in one call, and she told the owner both were renamed. The alias must land it as a rework.',
    seed: {
      goals: [{ title: 'Get a bar hang back', area: 'movement', type: 'recurring' }],
      activities: [
        {
          title: 'Grip finisher',
          goal: 'Get a bar hang back',
          recurrence: 'FREQ=WEEKLY;BYDAY=TU',
          duration: 10,
          how_to: 'Farmers carries — three trips.',
        },
      ],
    },
    turns: ['can you rename my grip finisher to "Hang time"?'],
    touches: ['pending_plan'],
    assert: async (ctx) => {
      const failures: string[] = [];
      const pp = (await userRow(ctx)).pending_plan;
      if (!pp) return ['no pending_plan was written — the rename went nowhere'];
      if (!inPending(pp, 'Hang time'))
        failures.push(
          `no proposed commitment is titled "Hang time" — proposal has: ${(pp.activities ?? []).map((a) => a.title).join(', ')}`,
        );
      if (inPending(pp, 'Grip finisher') && !inPending(pp, 'Hang time'))
        failures.push('the proposal still shows "Grip finisher" unrenamed');
      const committed = await committedTitles(ctx);
      if (!committed.includes('Grip finisher'))
        failures.push(`the COMMITTED plan changed without a tap — titles now: ${committed.join(', ')}`);
      return failures;
    },
  },

  {
    name: 'add-names-a-time',
    why:
      'Add without a time (2026-08-17): time_of_day was supplied on one add and dropped on its redo, and ' +
      'nothing could tell a deliberate "floats" from a forgotten field. An added commitment must carry a ' +
      'time — a clock, a part of day, or the literal "anytime".',
    seed: {
      goals: [RUN_GOAL],
      activities: [
        { title: 'Easy run', goal: 'Run a 10k in October', recurrence: 'FREQ=WEEKLY;BYDAY=TU', duration: 30 },
      ],
    },
    turns: ['add a 20 minute stretching session on wednesday evenings'],
    touches: ['pending_plan'],
    assert: async (ctx) => {
      const failures: string[] = [];
      const pp = (await userRow(ctx)).pending_plan;
      if (!pp) return ['no pending_plan was written — the add went nowhere'];
      const added = inPending(pp, 'stretch');
      if (!added)
        return [
          `nothing stretch-like was added — proposal has: ${(pp.activities ?? []).map((a) => a.title).join(', ')}`,
        ];
      if (!added.time_of_day?.trim())
        failures.push(`the added commitment has NO time_of_day — a decision ("evening" or "anytime") was required`);
      if (added.duration_min !== 20)
        failures.push(`duration_min is ${String(added.duration_min)}, expected exactly 20 (the minutes they said)`);
      if (!/BYDAY=WE(?![A-Z])/.test(added.recurrence ?? ''))
        failures.push(`recurrence is "${added.recurrence}", expected Wednesdays`);
      return failures;
    },
  },

  {
    name: 'resize-is-the-effort',
    why:
      'Duration means the effort (owner ruling 2026-08-17, shipped in #233): "a 40 minute run" stores 40 ' +
      '— never padded for warm-up or quietly shrunk. The stored number must be exactly theirs.',
    seed: {
      goals: [RUN_GOAL],
      activities: [
        { title: 'Long run', goal: 'Run a 10k in October', recurrence: 'FREQ=WEEKLY;BYDAY=SU', duration: 75 },
      ],
    },
    turns: ['make my long run 40 minutes for now'],
    touches: ['pending_plan'],
    assert: async (ctx) => {
      const pp = (await userRow(ctx)).pending_plan;
      if (!pp) return ['no pending_plan was written — the resize went nowhere'];
      const run = inPending(pp, 'Long run');
      if (!run)
        return [`Long run is not on the proposal — it has: ${(pp.activities ?? []).map((a) => a.title).join(', ')}`];
      if (run.duration_min !== 40)
        return [`stored duration_min is ${String(run.duration_min)}, expected exactly 40 (effort semantics)`];
      return [];
    },
  },

  {
    name: 'goal-retarget',
    why:
      'update_goal is an immediate write with no card — the sentence is the confirmation. The number ' +
      "must actually move, and the goal's own history must say so.",
    seed: {
      goals: [
        {
          title: 'Read 100 books this year',
          area: 'practice',
          type: 'target',
          measure: { target: 100, unit: 'books' },
          end: '2026-12-31',
        },
        RUN_GOAL,
      ],
    },
    turns: ["let's cut the reading goal down to 50 books — 100 was fantasy"],
    touches: ['goals'],
    assert: async (ctx) => {
      const failures: string[] = [];
      const goal = await goalByTitle(ctx, 'Read 100 books this year');
      if (!goal) return ['the reading goal row is gone entirely'];
      /**
       * The TITLE has to move with the number.
       *
       * The judge caught this on 2026-08-22 while this assert passed: the goal aimed at 50 and
       * still read "Read 100 books this year", which is the string every list and card shows. An
       * assert that only checks the field the tool just wrote can never see that.
       */
      if (/\b100\b/.test(String(goal.title ?? ''))) {
        failures.push(`the title still says 100 — "${String(goal.title)}" contradicts a target of 50`);
      }
      if (Number(goal.measure?.target) !== 50)
        failures.push(`goal target is ${String(goal.measure?.target)}, expected 50`);
      if (goal.status !== 'committed')
        failures.push(`goal status moved to "${goal.status}" — a retarget must not touch status`);
      const events = (await ctx.sql`
        select label from cadence.goal_events where user_id = ${ctx.userId} and label like 'Target changed:%'`) as unknown as Array<{
        label: string;
      }>;
      if (!events.length) failures.push('no "Target changed" event was written to the goal history');
      return failures;
    },
  },

  {
    name: 'constraint-lift-reword',
    why:
      'The 2026-08-16 pair: "removed" was claimed while the constraint sat untouched, and every reword ' +
      'was discarded by the longer-label merge. A lift keeps it on file as quiet (never deletes); a ' +
      'reword actually changes the words.',
    seed: {
      goals: [RUN_GOAL],
      constraints: [
        { label: 'right knee', kind: 'physical', status: 'active', plan_around: true },
        { label: 'ramp gently because of tendinitis', kind: 'physical', status: 'active', plan_around: true },
      ],
    },
    turns: [
      'good news — my right knee is completely fine now, you can stop planning around it',
      'also that note about ramping gently — it should just say "left ankle tendinitis"',
    ],
    touches: [],
    assert: async (ctx) => {
      const failures: string[] = [];
      const constraints = (await userRow(ctx)).baseline?.constraints ?? [];
      const labels = constraints.map((c) => c.label);
      const knee = constraints.find((c) => /right knee/i.test(c.label));
      if (!knee)
        failures.push(
          `the knee was REMOVED from file — recovering is a lift, not a removal. On file: ${labels.join('; ')}`,
        );
      else if (knee.plan_around !== false)
        failures.push(`the lift did not take: "right knee" still has plan_around=${String(knee.plan_around)}`);
      const reworded = constraints.find((c) => /left ankle tendinitis/i.test(c.label));
      if (!reworded)
        failures.push(
          `no constraint reads "left ankle tendinitis" — the reword did not land. On file: ${labels.join('; ')}`,
        );
      if (constraints.some((c) => /ramp gently/i.test(c.label)))
        failures.push('the old "ramp gently…" wording is still on file beside (or instead of) the new one');
      return failures;
    },
  },

  {
    name: 'log-spoken-session',
    why:
      'Talking about a finished session IS the record. She must write an occurrence — done, with their ' +
      'words kept on it — not just say warm things (2026-08-16: "she said she did but it didn\'t take").',
    seed: {
      goals: [MIND_GOAL],
      activities: [
        { title: 'Morning sit', goal: 'Sit for ten minutes most mornings', recurrence: 'FREQ=DAILY', duration: 10 },
      ],
      occurrences: [
        {
          activity: 'Morning sit',
          daysAgo: 1,
          status: 'done',
          value: { duration_min: 10 },
          summary: 'Ten quiet minutes',
          raw: 'sat the full ten',
        },
        { activity: 'Morning sit', daysAgo: 0, status: 'pending' },
      ],
    },
    turns: ['just finished my morning sit — a full ten minutes and I actually stayed with it today'],
    touches: ['occurrences'],
    assert: async (ctx) => {
      const rows = await occurrencesOf(ctx, 'Morning sit');
      const today = rows.find((r) => r.date === iso(0));
      if (!today) return ['no occurrence row exists for today at all'];
      if (today.status !== 'done') return [`today's Morning sit is still "${today.status}" — the log did not take`];
      if (!today.log) return ["today's sit is marked done but carries NO log — their words were dropped"];
      const kept = JSON.stringify(today.log);
      if (!/ten|10/i.test(kept)) return [`the log kept nothing of what they said: ${kept.slice(0, 140)}`];
      return [];
    },
  },

  {
    name: 'correct-logged-distance',
    why:
      'A correction of their own record takes effect immediately. The stored numbers must become what ' +
      'they said — not remain what was there while she apologises warmly.',
    seed: {
      goals: [RUN_GOAL],
      activities: [{ title: 'Easy run', goal: 'Run a 10k in October', recurrence: 'FREQ=DAILY', duration: 30 }],
      occurrences: [
        {
          activity: 'Easy run',
          daysAgo: 2,
          status: 'done',
          value: { distance_km: 5, duration_min: 31 },
          summary: '5 km in 31 minutes',
          raw: 'easy 5k, felt fine',
        },
      ],
    },
    turns: [`that easy run from ${iso(2)} was actually 8k, not 5 — can you fix it?`],
    touches: ['occurrences'],
    assert: async (ctx) => {
      const rows = await occurrencesOf(ctx, 'Easy run');
      const run = rows.find((r) => r.date === iso(2));
      if (!run) return [`the corrected occurrence (${iso(2)}) no longer exists`];
      if (run.status !== 'done') return [`the run's status became "${run.status}" — a metric fix must keep it done`];
      const km = Number(run.value?.distance_km);
      if (km !== 8) return [`stored distance_km is ${String(run.value?.distance_km)}, expected 8`];
      // The judge caught this once; now the assert holds it: a distance-only correction must not
      // erase the metrics it did not name (constraint-merge rule 1 — nothing dropped by silence).
      if (Number(run.value?.duration_min) !== 31)
        return [`stored duration_min is ${String(run.value?.duration_min)} — the correction named only distance`];
      return [];
    },
  },

  {
    name: 'macro-targets-adjust',
    why:
      'set_macro_targets is the coaching adjustment applied on the spot. The named numbers must move and ' +
      'the unnamed ones must survive (they are carried, not zeroed).',
    seed: {
      baseline: { weight_kg: { current: 84.2, start: 90, source: 'manual' }, height_cm: 181, sex: 'male' },
      macroTargets: { kcal: 2200, protein_g: 165, carbs_g: 220, fat_g: 70 },
      goals: [RUN_GOAL],
    },
    turns: ["let's set my calories to 2000 and protein to 160 — I want to cut a little"],
    touches: ['macro_targets'],
    assert: async (ctx) => {
      const failures: string[] = [];
      const macro = (await userRow(ctx)).macro_targets;
      if (!macro) return ['macro_targets is empty — the change went nowhere'];
      if (macro.kcal !== 2000) failures.push(`kcal is ${String(macro.kcal)}, expected 2000`);
      if (macro.protein_g !== 160) failures.push(`protein_g is ${String(macro.protein_g)}, expected 160`);
      if (macro.carbs_g == null || macro.fat_g == null)
        failures.push(
          `the unnamed targets were dropped: carbs_g=${String(macro.carbs_g)} fat_g=${String(macro.fat_g)}`,
        );
      return failures;
    },
  },
  /**
   * THE ONE THAT WAS MISSING, and the shape of the bug it would have caught.
   *
   * `macro-targets-adjust` above hands her the numbers — "set my calories to 2000 and protein to
   * 160". That tests the write. It does not test the COACHING, which is what the owner keeps
   * asking for and what kept failing: "set my nutritional targets", no numbers, work them out.
   *
   * To do that she needs body facts, and on 2026-08-22 those were unreachable by every route at
   * once — not in the per-turn floor, excluded from `find_tools` by construction, refused by
   * `use_tool` as "already in your context". Measured over twelve turns and two days: she called
   * `find_tools` and `get_goal_progress` repeatedly, every call succeeded, and `set_macro_targets`
   * was never reached. `eval:tools` could not see it either — it scores tool SELECTION on FIRST
   * turns, and she selected plenty.
   *
   * So this scenario deliberately withholds the numbers and seeds the facts, and asserts on the
   * DATABASE. Nothing about her prose counts: the whole failure mode was a conversation that
   * sounded like progress.
   *
   * The second turn is not decoration. A single request can be answered with a question, and
   * answering with a question is legitimate coaching — the failure was never one turn, it was the
   * loop. An explicit go-ahead removes the honest reason to stall, so anything still unset
   * afterwards is the harness, not her judgement.
   */
  {
    name: 'macro-targets-from-scratch',
    why:
      'The coaching case, not the write case: asked for targets with NO numbers given, she must reach the ' +
      'body facts and commit. On 2026-08-22 the weight was unreachable by every route at once and she never ' +
      'called set_macro_targets across twelve turns — every call succeeding, none able to work.',
    seed: {
      // Everything needed to work a target out is on file. If she asks for any of it, she is
      // asking for something she was already given.
      baseline: {
        weight_kg: { current: 88.5, start: 88.5, source: 'captured' },
        height_cm: 178,
        age: 41,
        sex: 'male',
      },
      goals: [RUN_GOAL],
    },
    turns: [
      'can you set my nutrition targets for me?',
      'yes please, go ahead and set them — use what you already know about me',
    ],
    touches: ['macro_targets'],
    assert: async (ctx) => {
      const failures: string[] = [];
      const macro = (await userRow(ctx)).macro_targets;

      // THE headline. Everything else is detail.
      if (!macro?.kcal) {
        return [
          'macro_targets is still empty after being asked twice — she never committed. This is the ' +
            '2026-08-22 failure exactly: tool calls without the work.',
        ];
      }

      // Sanity, not accuracy — the point is that a real number was chosen, not that we can grade a
      // nutritionist. A 41-year-old 88.5kg adult with a running goal is nowhere near these edges.
      if (macro.kcal < 1200 || macro.kcal > 4000) {
        failures.push(`kcal is ${String(macro.kcal)}, which is not a number anyone would defend out loud`);
      }
      if (macro.protein_g != null && (macro.protein_g < 40 || macro.protein_g > 300)) {
        failures.push(`protein_g is ${String(macro.protein_g)}, outside anything plausible`);
      }
      // The tool requires a reason, and the stamp is what makes a target revisitable later.
      if (!macro.last_reviewed) failures.push('last_reviewed was not stamped — the target cannot be reviewed later');
      return failures;
    },
  },
];
