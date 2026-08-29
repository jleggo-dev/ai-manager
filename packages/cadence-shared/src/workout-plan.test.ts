import { describe, it, expect } from 'vitest';
import { addSet, intervalTotalSeconds, singleSetPlan } from './interval.ts';
import type { OccurrenceSession, SessionItem } from './types/occurrence.ts';
import {
  composeWorkoutPlan,
  workoutFromIntervalPlan,
  workoutPlanId,
  type IntervalBlockSpec,
  type WorkoutBody,
  type WorkoutPlanSpec,
} from './workout-plan.ts';

const OCC = '11111111-2222-3333-4444-555555555555';

function session(items: SessionItem[]): OccurrenceSession {
  return {
    blocks: [{ label: 'Main', items }],
    note: '',
    generated_at: '2026-08-29T00:00:00.000Z',
    version: 1,
  };
}

/** Compose, asserting it produced something. Every test using this is about the SHAPE; the tests
 *  about composing nothing at all live in their own block and check for null directly. */
function composed(title: string, items: SessionItem[]): WorkoutPlanSpec {
  const plan = composeWorkoutPlan(OCC, title, session(items));
  if (!plan) throw new Error(`expected "${title}" to compose, got null`);
  return plan;
}

function customOf(body: WorkoutBody): Extract<WorkoutBody, { type: 'custom' }> {
  if (body.type !== 'custom') throw new Error(`expected a custom workout, got ${body.type}`);
  return body;
}

/** Wall-clock of a composed custom body, walked the way the watch would walk it. */
function customSeconds(body: WorkoutBody): number {
  const custom = customOf(body);
  const goalSec = (g: { kind: string; seconds?: number } | undefined) => (g?.kind === 'time' ? (g.seconds ?? 0) : 0);
  const blockSec = (b: IntervalBlockSpec) => b.iterations * b.steps.reduce((n, s) => n + goalSec(s.goal), 0);
  return goalSec(custom.warmup) + custom.blocks.reduce((n, b) => n + blockSec(b), 0) + goalSec(custom.cooldown);
}

describe('workoutPlanId', () => {
  it('is deterministic, so scheduling the same occurrence twice replaces rather than duplicates', () => {
    expect(workoutPlanId(OCC)).toBe(workoutPlanId(OCC));
  });

  it('differs per occurrence, so the read-back can attribute a finished workout', () => {
    expect(workoutPlanId(OCC)).not.toBe(workoutPlanId('99999999-2222-3333-4444-555555555555'));
  });
});

describe('composeWorkoutPlan — what maps to nothing', () => {
  it('returns null for an empty session', () => {
    expect(composeWorkoutPlan(OCC, 'Rest', null)).toBeNull();
    expect(composeWorkoutPlan(OCC, 'Rest', session([]))).toBeNull();
  });

  it('never composes a mind practice — a sit is not exercise', () => {
    const sit = session([{ name: 'Morning sit', tool: 'meditate', duration_min: 20 }]);
    expect(composeWorkoutPlan(OCC, 'Morning sit', sit)).toBeNull();
  });

  it('never composes breathing, grounding, feeling_log or journal even when they carry minutes', () => {
    for (const tool of ['breathing', 'grounding', 'feeling_log', 'journal'] as const) {
      const s = session([{ name: tool, tool, duration_min: 10 }]);
      expect(composeWorkoutPlan(OCC, tool, s)).toBeNull();
    }
  });

  it('returns null rather than an open goal when there is no distance and no time', () => {
    const s = session([{ name: 'Back squat', sets: 3, reps: 8, load: '60 kg' }]);
    expect(composeWorkoutPlan(OCC, 'Lower body', s)).toBeNull();
  });

  it('returns null for a checkoff list', () => {
    const s = session([{ name: 'Pack the bag', tool: 'checkoff' }]);
    expect(composeWorkoutPlan(OCC, 'Prep', s)).toBeNull();
  });
});

describe('composeWorkoutPlan — the three shapes', () => {
  it('distance AND time is a pacer workout', () => {
    const plan = composed('Tempo run', [{ name: 'Tempo run', distance_km: 5, duration_min: 28 }]);
    expect(plan.body).toEqual({ type: 'pacer', distanceKm: 5, durationSec: 28 * 60 });
    expect(plan.activity).toBe('running');
    expect(plan.location).toBe('outdoor');
  });

  it('distance alone is a distance goal', () => {
    expect(composed('Easy run', [{ name: 'Easy run', distance_km: 8 }]).body).toEqual({
      type: 'goal',
      goal: { kind: 'distance', km: 8 },
    });
  });

  it('time alone is a time goal — this is what carries heart rate for resistance work', () => {
    const plan = composed('Strength', [{ name: 'Kettlebell complex', duration_min: 30 }]);
    expect(plan.body).toEqual({ type: 'goal', goal: { kind: 'time', seconds: 1800 } });
    expect(plan.activity).toBe('functionalStrengthTraining');
  });

  it('sums across items, because the total is what the user was shown', () => {
    const plan = composed('Run', [
      { name: 'Warm-up jog', distance_km: 1, duration_min: 6 },
      { name: 'Main set', distance_km: 4, duration_min: 20 },
    ]);
    expect(plan.body).toEqual({ type: 'pacer', distanceKm: 5, durationSec: 26 * 60 });
  });

  it('ignores a mind item sitting alongside physical work', () => {
    const plan = composed('Run', [
      { name: 'Box breathing', tool: 'breathing', duration_min: 5 },
      { name: 'Easy run', distance_km: 5 },
    ]);
    expect(plan.body).toEqual({ type: 'goal', goal: { kind: 'distance', km: 5 } });
  });
});

describe('composeWorkoutPlan — intervals', () => {
  const HIIT: SessionItem = {
    name: 'HIIT',
    tool: 'interval',
    interval_work_sec: 40,
    interval_recover_sec: 20,
    interval_rounds: 6,
  };

  it('composes a custom workout from the flat interval fields, tagged or not', () => {
    const tagged = composed('HIIT', [HIIT]);
    const untagged = composed('HIIT', [
      { name: 'HIIT', interval_work_sec: 40, interval_recover_sec: 20, interval_rounds: 6 },
    ]);
    expect(tagged.body.type).toBe('custom');
    expect(untagged.body).toEqual(tagged.body);
  });

  it('one set is one block whose iterations are the rounds', () => {
    expect(composed('HIIT', [HIIT]).body).toMatchObject({
      type: 'custom',
      blocks: [
        {
          iterations: 6,
          steps: [
            { purpose: 'work', goal: { kind: 'time', seconds: 40 } },
            { purpose: 'recovery', goal: { kind: 'time', seconds: 20 } },
          ],
        },
      ],
    });
  });

  it('EMOM emits a work-only step — a zero-length recovery is not a rest, it is a tick', () => {
    const body = customOf(
      composed('EMOM', [
        {
          name: 'EMOM',
          tool: 'interval',
          interval_work_sec: 60,
          interval_recover_sec: 0,
          interval_rounds: 10,
        },
      ]).body,
    );
    expect(body.blocks.at(0)?.steps).toEqual([{ purpose: 'work', goal: { kind: 'time', seconds: 60 } }]);
  });

  it('carries warm-up and cool-down outside the blocks, so rounds never multiply them', () => {
    const body = composed('HIIT', [{ ...HIIT, interval_warmup_sec: 300, interval_cooldown_sec: 180 }]).body;
    expect(body).toMatchObject({
      warmup: { kind: 'time', seconds: 300 },
      cooldown: { kind: 'time', seconds: 180 },
    });
  });

  it('omits warm-up and cool-down entirely when they are zero', () => {
    const body = customOf(composed('HIIT', [HIIT]).body);
    expect(body.warmup).toBeUndefined();
    expect(body.cooldown).toBeUndefined();
  });

  it('the rest between sets is its OWN single-iteration block, never a step inside the rounds', () => {
    const plan = addSet(singleSetPlan({ workSec: 40, recoverSec: 20, rounds: 6 }));
    expect(plan.sets).toHaveLength(2);
    const body = customOf(workoutFromIntervalPlan(OCC, 'HIIT', plan).body);

    // set 1, the rest, set 2 — the rest standing alone is the whole point.
    expect(body.blocks).toHaveLength(3);
    expect(body.blocks.at(1)).toEqual({
      iterations: 1,
      steps: [{ purpose: 'recovery', goal: { kind: 'time', seconds: plan.restBetweenSetsSec } }],
    });
    // Folded into set 2 instead, it would repeat once per round rather than once.
    expect(body.blocks.at(2)?.steps).toHaveLength(2);
    expect(body.blocks.at(2)?.iterations).toBe(plan.sets.at(1)?.rounds);
  });

  it('a hand-edited multi-set plan keeps the wall-clock the sheet showed', () => {
    const plan = addSet(singleSetPlan({ warmupSec: 120, workSec: 30, recoverSec: 30, rounds: 8, cooldownSec: 120 }));
    expect(customSeconds(workoutFromIntervalPlan(OCC, 'HIIT', plan).body)).toBe(intervalTotalSeconds(plan));
  });

  it('an empty set list clamps to the default shape rather than composing nothing', () => {
    // The contract worth pinning: an interval plan ALWAYS composes, because clampIntervalPlan
    // fills an empty set list. Everything that maps to nothing is caught upstream, in
    // composeWorkoutPlan, where the caller can hide the affordance.
    const body = workoutFromIntervalPlan(OCC, 'HIIT', {
      warmupSec: 0,
      sets: [],
      restBetweenSetsSec: 0,
      cooldownSec: 0,
    }).body;
    expect(body.type).toBe('custom');
    expect(customSeconds(body)).toBeGreaterThan(0);
  });
});

describe('composeWorkoutPlan — the wall-clock is preserved', () => {
  // The property that matters: whatever the watch walks must last exactly as long as the run the
  // user was shown in the app. This is what catches a rest folded into the wrong place, a
  // multiplied warm-up, or a dropped cool-down — all of which type-check fine.
  const cases: Array<[string, SessionItem]> = [
    [
      'plain HIIT',
      { name: 'HIIT', tool: 'interval', interval_work_sec: 40, interval_recover_sec: 20, interval_rounds: 6 },
    ],
    ['EMOM', { name: 'EMOM', tool: 'interval', interval_work_sec: 60, interval_recover_sec: 0, interval_rounds: 10 }],
    [
      'tabata',
      { name: 'Tabata', tool: 'interval', interval_work_sec: 20, interval_recover_sec: 10, interval_rounds: 8 },
    ],
    [
      'with edges',
      {
        name: 'HIIT',
        tool: 'interval',
        interval_warmup_sec: 300,
        interval_work_sec: 45,
        interval_recover_sec: 15,
        interval_rounds: 12,
        interval_cooldown_sec: 240,
      },
    ],
    [
      'over the cap, so rounds are trimmed to fit',
      { name: 'Long', tool: 'interval', interval_work_sec: 600, interval_recover_sec: 600, interval_rounds: 20 },
    ],
  ];

  for (const [label, item] of cases) {
    it(`matches the player's own total — ${label}`, () => {
      const expected = intervalTotalSeconds(
        singleSetPlan({
          warmupSec: item.interval_warmup_sec,
          workSec: item.interval_work_sec,
          recoverSec: item.interval_recover_sec,
          rounds: item.interval_rounds,
          cooldownSec: item.interval_cooldown_sec,
        }),
      );
      expect(customSeconds(composed(item.name, [item]).body)).toBe(expected);
    });
  }
});

describe('composeWorkoutPlan — activity and location', () => {
  it('takes the longest matching word, so a rowing machine is not a row on a river', () => {
    const plan = composed('Rowing machine', [{ name: 'Rowing machine', duration_min: 20 }]);
    expect(plan.activity).toBe('rowing');
    expect(plan.location).toBe('indoor');
  });

  it('reads a treadmill run as running, indoors', () => {
    const plan = composed('Treadmill run', [{ name: 'Treadmill run', distance_km: 5 }]);
    expect(plan.activity).toBe('running');
    expect(plan.location).toBe('indoor');
  });

  it('defaults running, walking, hiking and cycling to outdoors', () => {
    for (const [title, activity] of [
      ['Morning run', 'running'],
      ['Long walk', 'walking'],
      ['Hike', 'hiking'],
      ['Bike ride', 'cycling'],
    ] as const) {
      const plan = composed(title, [{ name: title, distance_km: 5 }]);
      expect(plan.activity).toBe(activity);
      expect(plan.location).toBe('outdoor');
    }
  });

  it('leaves location unknown for indoor-ish work rather than guessing', () => {
    const plan = composed('Core work', [{ name: 'Plank holds', duration_min: 12 }]);
    expect(plan.activity).toBe('coreTraining');
    expect(plan.location).toBe('unknown');
  });

  it('falls back to other when nothing matches, rather than refusing to compose', () => {
    const plan = composed('Wednesday session', [{ name: 'Wednesday session', duration_min: 30 }]);
    expect(plan.activity).toBe('other');
  });

  it('reads the item detail too, not just the title', () => {
    const plan = composed('Wednesday', [{ name: 'Session', detail: 'easy jog, conversational', duration_min: 30 }]);
    expect(plan.activity).toBe('running');
  });

  it('names the plan with the occurrence title, because that is what the watch card shows', () => {
    const plan = composed('Thursday intervals', [{ name: 'Intervals', distance_km: 5 }]);
    expect(plan.displayName).toBe('Thursday intervals');
  });
});
