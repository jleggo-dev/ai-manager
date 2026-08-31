/**
 * The interval engine's parity fixture — one artifact both implementations are pinned to.
 *
 * `IntervalEngine.swift` on the watch is a hand port of `interval.ts` and is marked KEEP IN
 * LOCKSTEP, which until now was a comment and nothing else. A drift between them is not a cosmetic
 * bug: the phone and the watch would count a different number of rounds for the same session, and
 * the one that wrote the log would decide what happened.
 *
 * Rather than two test suites that can quietly disagree, both sides read THIS: TypeScript asserts
 * it still produces the fixture, Swift asserts it produces the same fixture. A change to either
 * implementation fails on one side or the other.
 *
 * Regenerate with `npm run gen:interval-parity -w @cadence/shared` after a deliberate change to
 * the engine, and read the diff — a changed expectation is the point of review, not a chore.
 */
import {
  clampIntervalPlan,
  expandIntervalPhases,
  intervalTotalSeconds,
  roundsCompleted,
  totalRounds,
  type IntervalPlan,
} from './interval.ts';

export interface ParityPhase {
  kind: string;
  label: string;
  seconds: number;
  round: number | null;
  globalRound: number | null;
}

export interface ParityCase {
  name: string;
  plan: IntervalPlan;
  totalSeconds: number;
  totalRounds: number;
  phases: ParityPhase[];
  /** Rounds completed at a few elapsed marks — the property "stopping early keeps the rounds you
   *  did" depends on, and the one most likely to drift between two hand-written walkers. */
  roundsAt: Array<{ elapsed: number; rounds: number }>;
}

export interface ParityFixture {
  cases: ParityCase[];
}

/**
 * The plans worth pinning. Each is a shape the coach actually prescribes or the edit sheet can
 * build, plus the two that exercise the clamps — bounds are exactly where two implementations
 * drift, because they are the part nobody re-derives when porting.
 */
const PLANS: ReadonlyArray<readonly [string, IntervalPlan]> = [
  [
    'hiit 40/20 x6',
    { warmupSec: 0, sets: [{ workSec: 40, recoverSec: 20, rounds: 6 }], restBetweenSetsSec: 60, cooldownSec: 0 },
  ],
  [
    'tabata 20/10 x8',
    { warmupSec: 0, sets: [{ workSec: 20, recoverSec: 10, rounds: 8 }], restBetweenSetsSec: 60, cooldownSec: 0 },
  ],
  // EMOM: zero recovery must emit NO recover phase at all, not a zero-length one.
  [
    'emom 60/0 x10',
    { warmupSec: 0, sets: [{ workSec: 60, recoverSec: 0, rounds: 10 }], restBetweenSetsSec: 60, cooldownSec: 0 },
  ],
  [
    'warmup + cooldown',
    { warmupSec: 300, sets: [{ workSec: 45, recoverSec: 15, rounds: 5 }], restBetweenSetsSec: 60, cooldownSec: 180 },
  ],
  // Multi-set: the rest sits OUTSIDE the rounds, so counts never multiply it.
  [
    'two sets with rest',
    {
      warmupSec: 60,
      sets: [
        { workSec: 30, recoverSec: 30, rounds: 4 },
        { workSec: 20, recoverSec: 40, rounds: 3 },
      ],
      restBetweenSetsSec: 90,
      cooldownSec: 60,
    },
  ],
  [
    'four sets',
    {
      warmupSec: 0,
      sets: [
        { workSec: 30, recoverSec: 15, rounds: 3 },
        { workSec: 30, recoverSec: 15, rounds: 3 },
        { workSec: 30, recoverSec: 15, rounds: 3 },
        { workSec: 30, recoverSec: 15, rounds: 3 },
      ],
      restBetweenSetsSec: 45,
      cooldownSec: 0,
    },
  ],
  // Clamped: past every bound at once, and trimmed to fit the session cap.
  [
    'over every bound',
    {
      warmupSec: 9999,
      sets: [{ workSec: 9999, recoverSec: 9999, rounds: 999 }],
      restBetweenSetsSec: 9999,
      cooldownSec: 9999,
    },
  ],
  [
    'under every bound',
    { warmupSec: -5, sets: [{ workSec: 1, recoverSec: -3, rounds: 0 }], restBetweenSetsSec: -1, cooldownSec: -1 },
  ],
  [
    'zero warmup and cooldown',
    { warmupSec: 0, sets: [{ workSec: 25, recoverSec: 35, rounds: 2 }], restBetweenSetsSec: 0, cooldownSec: 0 },
  ],
];

/** Elapsed marks probed per case: the start, a third in, two thirds in, the exact end, and past
 *  the end — the boundary conditions where an off-by-one in either walker shows up. */
function marks(total: number): number[] {
  return [0, Math.floor(total / 3), Math.floor((total * 2) / 3), total, total + 30];
}

export function buildParityFixture(): ParityFixture {
  return {
    cases: PLANS.map(([name, raw]) => {
      const plan = clampIntervalPlan(raw);
      const phases = expandIntervalPhases(plan);
      const total = intervalTotalSeconds(plan);
      return {
        name,
        plan,
        totalSeconds: total,
        totalRounds: totalRounds(plan),
        phases: phases.map((p) => ({
          kind: p.kind,
          label: p.label,
          seconds: p.seconds,
          round: p.round ?? null,
          globalRound: p.globalRound ?? null,
        })),
        roundsAt: marks(total).map((elapsed) => ({ elapsed, rounds: roundsCompleted(phases, elapsed) })),
      };
    }),
  };
}
