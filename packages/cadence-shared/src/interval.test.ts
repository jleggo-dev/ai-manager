import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ROUNDS,
  INTERVAL_TEMPLATES,
  MAX_INTERVAL_SEC,
  MAX_ROUNDS,
  MIN_WORK_SEC,
  applyTemplate,
  clampIntervalPlan,
  expandIntervalPhases,
  intervalLogLine,
  intervalShorthand,
  intervalTotalMinutes,
  intervalTotalSeconds,
  matchTemplate,
  phaseStartMarks,
  positionAt,
  roundsCompleted,
  type IntervalPlan,
} from './interval.ts';

const HIIT: IntervalPlan = { warmupSec: 120, workSec: 40, recoverSec: 20, rounds: 6, cooldownSec: 60 };

describe('clampIntervalPlan', () => {
  it('fills the defaults when the coach sent nothing', () => {
    expect(clampIntervalPlan(null)).toEqual({
      warmupSec: 0,
      workSec: 40,
      recoverSec: 20,
      rounds: DEFAULT_ROUNDS,
      cooldownSec: 0,
    });
  });

  it('defaults warm-up and cool-down to NONE — the session has its own warm-up block', () => {
    const p = clampIntervalPlan({ workSec: 30, rounds: 4 });
    expect(p.warmupSec).toBe(0);
    expect(p.cooldownSec).toBe(0);
  });

  it('clamps every number into range and rounds fractions', () => {
    const p = clampIntervalPlan({ warmupSec: 5000, workSec: 1, recoverSec: -10, rounds: 99, cooldownSec: 40.4 });
    expect(p.warmupSec).toBe(900);
    expect(p.workSec).toBe(MIN_WORK_SEC);
    expect(p.recoverSec).toBe(0);
    expect(p.rounds).toBe(MAX_ROUNDS);
    expect(p.cooldownSec).toBe(40);
  });

  it('trims ROUNDS until the whole run fits the cap, rather than refusing the prescription', () => {
    const p = clampIntervalPlan({ workSec: 600, recoverSec: 600, rounds: 20 });
    expect(p.rounds).toBe(3); // 3 × 1200s = 3600s exactly
    expect(intervalTotalSeconds(p)).toBeLessThanOrEqual(MAX_INTERVAL_SEC);
  });

  it('never returns fewer than one round, even when the edges eat the whole budget', () => {
    expect(
      clampIntervalPlan({ warmupSec: 900, cooldownSec: 900, workSec: 600, recoverSec: 600, rounds: 8 }).rounds,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('expandIntervalPhases', () => {
  it('lays out warm-up → (work / recover) × rounds → cool-down', () => {
    const phases = expandIntervalPhases(HIIT);
    expect(phases).toHaveLength(1 + 6 * 2 + 1);
    expect(phases[0]).toEqual({ kind: 'neutral', label: 'Warm-up', seconds: 120 });
    expect(phases[1]).toEqual({ kind: 'work', label: 'Work', seconds: 40, round: 1 });
    expect(phases[2]).toEqual({ kind: 'recover', label: 'Recover', seconds: 20, round: 1 });
    expect(phases[phases.length - 1]).toEqual({ kind: 'neutral', label: 'Cool-down', seconds: 60 });
  });

  it('drops the zero-length phases entirely — which is all EMOM is', () => {
    const emom = clampIntervalPlan({ workSec: 60, recoverSec: 0, rounds: 3 });
    const phases = expandIntervalPhases(emom);
    expect(phases).toHaveLength(3);
    expect(phases.every((p) => p.kind === 'work')).toBe(true);
    expect(phases.map((p) => p.round)).toEqual([1, 2, 3]);
  });

  it('never carries a round number on warm-up or cool-down — they sit outside the multiplication', () => {
    for (const p of expandIntervalPhases(HIIT)) {
      if (p.kind === 'neutral') expect(p.round).toBeUndefined();
      else expect(p.round).toBeGreaterThan(0);
    }
  });
});

describe('totals', () => {
  it('sums the run including the edges', () => {
    expect(intervalTotalSeconds(HIIT)).toBe(120 + 6 * 60 + 60); // 9:00 of rounds + 3:00 of edges
    expect(intervalTotalMinutes(HIIT)).toBe(9);
  });

  it('floors at one minute so a short run never renders as "0 min"', () => {
    expect(intervalTotalMinutes(clampIntervalPlan({ workSec: 5, recoverSec: 0, rounds: 1 }))).toBe(1);
  });
});

describe('positionAt', () => {
  const phases = expandIntervalPhases(HIIT);

  it('reads the warm-up at t=0, with the first work phase named as next', () => {
    const p = positionAt(phases, 0);
    expect(p.phase.label).toBe('Warm-up');
    expect(p.remaining).toBe(120);
    expect(p.progress).toBe(0);
    expect(p.next?.label).toBe('Work');
    expect(p.roundsDone).toBe(0);
  });

  it('lands on the exact phase for a mid-run second (round 3 recover, 12s left)', () => {
    // 120 warm-up + 2 full rounds (120) + 40 work + 8 of the recover = 288
    const p = positionAt(phases, 288);
    expect(p.phase.kind).toBe('recover');
    expect(p.phase.round).toBe(3);
    expect(p.remaining).toBe(12);
    expect(p.roundsDone).toBe(2);
    expect(p.next?.kind).toBe('work');
  });

  it('is a pure function of elapsed time — a skipped tick cannot desynchronize it', () => {
    expect(positionAt(phases, 288)).toEqual(positionAt(phases, 288));
    // Jumping 30s (a backgrounded tab) lands where the clock says, not one phase on.
    expect(positionAt(phases, 318).phase.round).toBe(4);
  });

  it('credits a round only once its LAST phase has ended', () => {
    expect(positionAt(phases, 120 + 40).roundsDone).toBe(0); // work done, recover not
    expect(positionAt(phases, 120 + 60).roundsDone).toBe(1);
  });

  it('finishes at the total and reports every round done', () => {
    const p = positionAt(phases, intervalTotalSeconds(HIIT));
    expect(p.done).toBe(true);
    expect(p.remaining).toBe(0);
    expect(p.roundsDone).toBe(6);
    expect(p.next).toBeUndefined();
  });

  it('is total on an empty list rather than throwing', () => {
    expect(positionAt([], 5).done).toBe(true);
  });
});

describe('roundsCompleted / phaseStartMarks', () => {
  it('counts rounds behind an elapsed mark', () => {
    const phases = expandIntervalPhases(clampIntervalPlan({ workSec: 20, recoverSec: 10, rounds: 8 }));
    expect(roundsCompleted(phases, 0)).toBe(0);
    expect(roundsCompleted(phases, 90)).toBe(3);
    expect(roundsCompleted(phases, 240)).toBe(8);
  });

  it('marks where each phase begins — the chime schedule', () => {
    const phases = expandIntervalPhases(clampIntervalPlan({ workSec: 40, recoverSec: 20, rounds: 2 }));
    expect(phaseStartMarks(phases)).toEqual([0, 40, 60, 100]);
  });
});

describe('templates', () => {
  it('recognises the familiar shapes by their numbers alone', () => {
    expect(matchTemplate(HIIT)).toBe('hiit');
    expect(matchTemplate(clampIntervalPlan({ workSec: 20, recoverSec: 10, rounds: 8 }))).toBe('tabata');
    expect(matchTemplate(clampIntervalPlan({ workSec: 60, recoverSec: 0, rounds: 10 }))).toBe('emom');
    expect(matchTemplate(clampIntervalPlan({ workSec: 45, recoverSec: 15, rounds: 5 }))).toBeNull();
  });

  it('matches on the SET only — a warm-up someone added is still HIIT', () => {
    expect(matchTemplate({ ...HIIT, warmupSec: 300, cooldownSec: 0 })).toBe('hiit');
  });

  it('seeds the set and leaves the edges alone', () => {
    const seeded = applyTemplate(HIIT, 'tabata');
    expect(seeded).toEqual({ warmupSec: 120, workSec: 20, recoverSec: 10, rounds: 8, cooldownSec: 60 });
  });

  it('every template round-trips through the clamp untouched', () => {
    for (const t of INTERVAL_TEMPLATES) {
      const plan = clampIntervalPlan({ workSec: t.workSec, recoverSec: t.recoverSec, rounds: t.rounds });
      expect(matchTemplate(plan), t.id).toBe(t.id);
    }
  });
});

describe('words', () => {
  it('states the prescription the way the chip draws it', () => {
    expect(intervalShorthand(HIIT)).toBe('6 × 40/20');
    expect(intervalShorthand(clampIntervalPlan({ workSec: 20, recoverSec: 10, rounds: 8 }))).toBe('8 × 20/10');
  });

  it('drops the slash when there is no separate recover', () => {
    expect(intervalShorthand(clampIntervalPlan({ workSec: 60, recoverSec: 0, rounds: 10 }))).toBe('10 × 1:00');
  });

  it('logs what happened, never the prescription', () => {
    const run = { totalRounds: 6, targetSec: 540, shorthand: intervalShorthand(HIIT) };
    expect(intervalLogLine({ ...run, roundsDone: 6, elapsedSec: 540 })).toBe('6 × 40/20 · done');
    expect(intervalLogLine({ ...run, roundsDone: 4, elapsedSec: 380 })).toBe('4 of 6 rounds · 6:20 of 9:00');
    expect(intervalLogLine({ ...run, roundsDone: 0, elapsedSec: 30 })).toBe('0 of 6 rounds · 0:30 of 9:00');
  });

  it('describes the run someone EDITED, not the plan they were handed', () => {
    // Coach said 6 × 40/20; they cut it to 4 × 30/30 and finished that.
    expect(
      intervalLogLine({ roundsDone: 4, totalRounds: 4, elapsedSec: 240, targetSec: 240, shorthand: '4 × 30/30' }),
    ).toBe('4 × 30/30 · done');
  });
});
