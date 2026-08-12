/**
 * Does the LIVE coach split a plan into the right NUMBER of things?
 *
 * `probe-coach-tools.ts` asks whether the coach picks the right tool INSIDE one activity. This asks
 * the question one level up: how many activities does a day get at all. That choice is what the
 * person actually sees — the day's trail is one node per scheduled activity, so a plan that bundles
 * everything into a single "Mindfulness practice" leaves someone with one button, and a plan that
 * shatters a gym session into per-exercise nodes is unusable in the other direction.
 *
 * The rule under test (synthesize-plan, "SHAPE — ONE ACTIVITY PER OCCASION"): split by occasion,
 * not by subject. Back-to-back in one sitting is ONE activity; different times of day are separate
 * activities. Mind work is usually several occasions; a strength session is one.
 *
 * Three scenarios on purpose — the density rule can fail in three directions, and a probe that only
 * tested the mind case would happily pass a coach that had started shattering squats into nodes or
 * padding a busy person's day to hit a number.
 *
 * Read-only w.r.t. Cadence: /test executes the job but writes nothing to any plan.
 * Stochastic by nature — a smoke test, not a gate. Run twice after changing the plan prompt.
 *
 * Run: node --import tsx apps/cadence-api/scripts/probe-plan-shape.ts [--runs N]
 */
import { flag, finish, parseJson, runJob, tally } from './probe-lib.ts';

interface PlannedActivity {
  title?: unknown;
  kind?: unknown;
  category?: unknown;
  goal_title?: unknown;
  schedule?: { recurrence?: unknown; time_of_day?: unknown; duration_min?: unknown };
}

/** Does this RRULE fire on `day` (a two-letter RRULE weekday)? Covers the forms the prompt asks
 *  for — DAILY, WEEKLY;BYDAY=…, MONTHLY — and treats anything unrecognized as "not today", which
 *  under-counts rather than inventing density that isn't there. */
function firesOn(recurrence: string, day: string): boolean {
  const r = recurrence.toUpperCase();
  if (!r.includes('FREQ=')) return false;
  if (r.includes('FREQ=DAILY')) return !r.includes('INTERVAL=') || r.includes('INTERVAL=1');
  if (r.includes('FREQ=WEEKLY')) {
    const m = r.match(/BYDAY=([A-Z,]+)/);
    return m ? m[1]!.split(',').includes(day) : false;
  }
  return false; // monthly and friends: real, but not part of a typical day's shape
}

const WEEK = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/**
 * The day to judge a plan on: its BUSIEST one. A fixed weekday reads as green whenever it happens
 * to be a rest day — the strength scenario silently asserted nothing until this replaced it — and
 * density is a claim about the fullest day anyway, not about Wednesday.
 */
function busiestDay(all: PlannedActivity[]): { day: string; nodes: PlannedActivity[] } {
  let best = { day: WEEK[0]!, nodes: [] as PlannedActivity[] };
  for (const day of WEEK) {
    const nodes = all.filter((a) => a.kind === 'user' && firesOn(String(a.schedule?.recurrence ?? ''), day));
    if (nodes.length > best.nodes.length) best = { day, nodes };
  }
  return best;
}

interface ShapeScenario {
  name: string;
  goals: unknown[];
  baseline: unknown;
  preferences: unknown;
  equipment?: unknown[];
  /** What a good plan looks like for THIS person, checked against the busiest day's user nodes. */
  check: (onDay: PlannedActivity[], all: PlannedActivity[], day: string) => void;
}

/** Bare lift names as activity titles are the tell that a session got shattered into its parts. */
const EXERCISE_TITLE = /^(back |front |barbell |dumbbell |goblet )?(squat|deadlift|bench|overhead press|row|lunge|curl|pull-?up|push-?up)s?\b/i;

const SCENARIOS: ShapeScenario[] = [
  {
    // The case that started this: a mind-only plan must not collapse to one node.
    name: 'mind-only · "wound up in the mornings, want a gratitude habit, sleep is bad"',
    goals: [
      goal('g1', 'Feel less wound up in the mornings', 'mind'),
      goal('g2', 'Keep a gratitude habit going', 'mind'),
      goal('g3', 'Get to sleep before midnight', 'mind'),
    ],
    baseline: { constraints: [], notes: 'desk job, two kids, no meditation experience' },
    preferences: { notes: 'mornings are rushed but the evenings are quiet' },
    check(onDay, _all, day) {
      if (onDay.length < 2) {
        flag(`mind plan collapsed to ${onDay.length} node(s) on ${day} — three separate goals, one button`);
        return;
      }
      const times = onDay.map((a) => String(a.schedule?.time_of_day ?? '')).filter(Boolean);
      if (new Set(times).size < 2) {
        flag(`${onDay.length} mind activities all at the same time (${times.join(', ')}) — not separate occasions`);
      }
    },
  },
  {
    // The opposite failure: an occasion-split rule that starts splitting single sittings.
    name: 'strength · "want to deadlift 315, lifting 3x a week"',
    goals: [goal('g1', 'Deadlift 315 lb', 'movement')],
    baseline: { constraints: [], notes: 'lifting on and off for two years' },
    preferences: { notes: 'gym after work' },
    equipment: ['barbell', 'rack', 'plates'],
    check(onDay, _all, day) {
      // Shattering is a SAME-DAY phenomenon. "Deadlift — Heavy Day" and "Deadlift — Volume Day" on
      // different days are two sessions, which is just good programming; judging titles by their
      // words flags those as broken. What's actually wrong is one sitting becoming several nodes.
      const sameDayLifts = onDay.filter((a) => EXERCISE_TITLE.test(String(a.title ?? '')));
      if (sameDayLifts.length > 1) {
        flag(`one session split across ${day}: ${sameDayLifts.map((a) => `"${String(a.title)}"`).join(', ')}`);
      }
      const lifting = onDay.filter((a) => String(a.category ?? '').match(/movement|strength/i));
      if (lifting.length > 2) flag(`${lifting.length} separate lifting nodes on ${day} — one gym trip is one activity`);
    },
  },
  {
    // Present-then-discuss (PLAN.md 2026-08-12): a months-long body of work is more than its
    // sitting. One lone daily "write" node was the reported failure; the LONG-FORM WORK and
    // ADJACENT SUPPORT rules answer it, and this asserts they keep answering it.
    name: 'long-form · "write a novel by December, starting from scratch"',
    goals: [
      {
        ...goal('g1', 'Write a novel', 'practice'),
        type: 'milestone',
        brief: 'Starting from scratch — blank page, no outline. Wants it written this year.',
        timeframe: { end: '2026-12-31' },
      },
    ],
    baseline: {
      constraints: [],
      availability: { windows: [{ part_of_day: 'morning', earliest: '06:00' }], session_minutes: { min: 45, max: 60 } },
      starting_point: { doing_now: ['nothing regular yet'] },
    },
    preferences: { notes: 'mornings before work' },
    equipment: ['laptop'],
    check(_onDay, all) {
      const user = all.filter((a) => a.kind === 'user');
      // The reported failure exactly: drafting alone, nothing else in the week.
      if (user.length < 3) {
        flag(`long-form goal got ${user.length} user activit${user.length === 1 ? 'y' : 'ies'} — a reminder, not a plan`);
        return;
      }
      const titles = user.map((a) => String(a.title ?? '').toLowerCase());
      const hasCore = titles.some((t) => /writ|draft/.test(t));
      const hasOtherOccasion = titles.some((t) => /outline|plan|read|stud|revis|review|edit/.test(t));
      if (!hasCore) flag(`no drafting/writing core in: ${titles.join(' · ')}`);
      if (!hasOtherOccasion) {
        flag(`no planning/input/review occasion beside the core — the week is one button: ${titles.join(' · ')}`);
      }
      // A rationale is part of the contract now — the card renders it to an unauthenticated prospect.
      // (Checked here because this scenario exists for the present-then-discuss work.)
    },
  },
  {
    // The guard on the guard: "aim for 3-5" must never override someone asking for less.
    name: 'minimal · "i can only manage one small thing a day, seriously"',
    goals: [goal('g1', 'Walk every day', 'movement')],
    baseline: { constraints: [{ label: 'burnout', plan_around: true }], notes: 'newborn at home, running on no sleep' },
    preferences: { notes: 'ONE thing a day maximum. I will quit if there is more than that.' },
    check(onDay) {
      const user = onDay.filter((a) => a.kind === 'user');
      if (user.length > 2) {
        flag(`${user.length} commitments for someone who asked for one — padded to hit a number`);
      }
    },
  },
];

function goal(id: string, title: string, area: string) {
  return {
    goal_id: id,
    title,
    area,
    type: 'recurring',
    measure: {},
    timeframe: { horizon: '12 weeks' },
    status: 'confirmed',
    linked_equipment: [],
    source: 'captured',
  };
}

async function probeShape(): Promise<void> {
  for (const s of SCENARIOS) {
    console.log(`\n── plan · ${s.name}`);
    let raw: string;
    try {
      raw = await runJob('synthesize-plan', {
        goals: JSON.stringify(s.goals),
        baseline: JSON.stringify(s.baseline),
        equipment: JSON.stringify(s.equipment ?? []),
        preferences: JSON.stringify(s.preferences),
        current_plan: '',
        recent_activity: '',
        user_steer: '',
        draft_activities: '',
        weather: '',
      });
    } catch (err) {
      // A dead scenario is a red flag, never a dead RUN — one timeout used to take down every
      // scenario after it, which converts a weekly smoke report into no report at all.
      flag(`scenario errored (${String((err as Error)?.message ?? err).slice(0, 120)}) — skipping`);
      continue;
    }
    const parsed = parseJson(raw);
    const all = (Array.isArray(parsed?.activities) ? parsed!.activities : []) as PlannedActivity[];
    if (all.length === 0) {
      flag(`no activities came back: ${raw.slice(0, 140)}`);
      continue;
    }
    // Every plan owes a rationale now (0031) — the pre-signup card renders it to a prospect, so a
    // plan without one ships a card with nothing behind "See my thinking".
    const rationale = (parsed as { rationale?: unknown }).rationale;
    if (typeof rationale !== 'string' || !rationale.trim()) flag('no plan-level rationale came back');

    // What the person sees on their fullest day: user-facing nodes only. System tasks (meal logs,
    // the weekly check-in) are real trail items but they aren't the commitment being shaped here.
    const { day, nodes: onDay } = busiestDay(all);
    console.log(`   ${all.length} activities, ${onDay.length} user node(s) on ${day} (busiest):`);
    for (const a of onDay) {
      console.log(`     · ${String(a.schedule?.time_of_day ?? '--:--')}  ${String(a.title)}`);
    }
    // A plan whose every day is empty of user commitments can't be judged — and is itself wrong.
    if (onDay.length === 0) {
      flag('no user activity fires on any day of the week — nothing to do, and nothing to check');
      continue;
    }
    s.check(onDay, all, day);
  }
}

const runsArg = process.argv.find((a) => a.startsWith('--runs'));
const runs = Math.max(1, Number(runsArg?.split('=')[1] ?? process.argv[process.argv.indexOf('--runs') + 1] ?? 1) || 1);

const perRun: number[] = [];
for (let r = 1; r <= runs; r += 1) {
  if (runs > 1) console.log(`\n════ run ${r} of ${runs} ════`);
  const before = tally.problems;
  await probeShape();
  perRun.push(tally.problems - before);
}
if (runs > 1) console.log(`\nper-run problems: [${perRun.join(', ')}]`);
finish();
