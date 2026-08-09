import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REST_BETWEEN_SETS_SEC,
  DEFAULT_ROUNDS,
  INTERVAL_TEMPLATES,
  MAX_INTERVAL_SEC,
  MAX_ROUNDS,
  MAX_SETS,
  MIN_WORK_SEC,
  addSet,
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
  removeSet,
  roundsCompleted,
  setShorthand,
  singleSetPlan,
  totalRounds,
  updateSet,
  type IntervalPlan,
} from './interval.ts';

/** `sets[i]` without a non-null assertion — this workspace bans them, and a test that indexes
 *  past the end should read as a clear 0 rather than throw somewhere unhelpful. */
const setAt = (p: IntervalPlan, i = 0) => p.sets[i] ?? { workSec: 0, recoverSec: 0, rounds: 0 };

const HIIT: IntervalPlan = singleSetPlan({
  warmupSec: 120,
  workSec: 40,
  recoverSec: 20,
  rounds: 6,
  cooldownSec: 60,
});

/** HIIT, then an EMOM finisher — the design's own "Add set 2" example. */
const TWO_SETS: IntervalPlan = clampIntervalPlan({
  warmupSec: 60,
  sets: [
    { workSec: 40, recoverSec: 20, rounds: 6 },
    { workSec: 60, recoverSec: 0, rounds: 4 },
  ],
  restBetweenSetsSec: 90,
  cooldownSec: 0,
});

describe('clampIntervalPlan', () => {
  it('fills the defaults when the coach sent nothing', () => {
    expect(clampIntervalPlan(null)).toEqual({
      warmupSec: 0,
      sets: [{ workSec: 40, recoverSec: 20, rounds: DEFAULT_ROUNDS }],
      restBetweenSetsSec: DEFAULT_REST_BETWEEN_SETS_SEC,
      cooldownSec: 0,
    });
  });

  it('defaults warm-up and cool-down to NONE — the session has its own warm-up block', () => {
    const p = singleSetPlan({ workSec: 30, rounds: 4 });
    expect(p.warmupSec).toBe(0);
    expect(p.cooldownSec).toBe(0);
  });

  it('clamps every number into range and rounds fractions', () => {
    const p = singleSetPlan({ warmupSec: 5000, workSec: 1, recoverSec: -10, rounds: 99, cooldownSec: 40.4 });
    expect(p.warmupSec).toBe(900);
    expect(setAt(p)).toEqual({ workSec: MIN_WORK_SEC, recoverSec: 0, rounds: MAX_ROUNDS });
    expect(p.cooldownSec).toBe(40);
  });

  it('never returns zero sets — an empty run is not a state the player can render', () => {
    expect(clampIntervalPlan({ sets: [] }).sets).toHaveLength(1);
  });

  it('caps the number of sets', () => {
    const many = clampIntervalPlan({
      sets: Array.from({ length: 9 }, () => ({ workSec: 20, recoverSec: 10, rounds: 2 })),
    });
    expect(many.sets).toHaveLength(MAX_SETS);
  });

  it('trims ROUNDS until the whole run fits the cap, rather than refusing the prescription', () => {
    const p = singleSetPlan({ workSec: 600, recoverSec: 600, rounds: 20 });
    expect(setAt(p).rounds).toBe(3); // 3 × 1200s = 3600s exactly
    expect(intervalTotalSeconds(p)).toBeLessThanOrEqual(MAX_INTERVAL_SEC);
  });

  it('trims from the LAST set first — the first set is the session, the rest are finishers', () => {
    const p = clampIntervalPlan({
      sets: [
        { workSec: 60, recoverSec: 0, rounds: 10 }, // 600s
        { workSec: 300, recoverSec: 60, rounds: 10 }, // 3600s — the overspill
      ],
      restBetweenSetsSec: 0,
    });
    expect(setAt(p, 0).rounds).toBe(10); // untouched
    expect(setAt(p, 1).rounds).toBe(8); // shaved just enough
    expect(intervalTotalSeconds(p)).toBeLessThanOrEqual(MAX_INTERVAL_SEC);
  });

  it('cascades back to earlier sets only once the later ones are at their floor', () => {
    const p = clampIntervalPlan({
      sets: [
        { workSec: 300, recoverSec: 60, rounds: 10 }, // 3600s on its own — the cap, alone
        { workSec: 60, recoverSec: 0, rounds: 10 },
      ],
      restBetweenSetsSec: 0,
    });
    expect(setAt(p, 1).rounds).toBe(1); // floored first
    expect(setAt(p, 0).rounds).toBe(9); // then, and only then, the first set gives one up
    expect(intervalTotalSeconds(p)).toBeLessThanOrEqual(MAX_INTERVAL_SEC);
  });

  it('never returns fewer than one round, even when the edges eat the whole budget', () => {
    expect(
      setAt(singleSetPlan({ warmupSec: 900, cooldownSec: 900, workSec: 600, recoverSec: 600, rounds: 8 })).rounds,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('expandIntervalPhases', () => {
  it('lays out warm-up → (work / recover) × rounds → cool-down', () => {
    const phases = expandIntervalPhases(HIIT);
    expect(phases).toHaveLength(1 + 6 * 2 + 1);
    expect(phases[0]).toEqual({ kind: 'neutral', label: 'Warm-up', seconds: 120 });
    expect(phases[1]).toEqual({ kind: 'work', label: 'Work', seconds: 40, round: 1, set: 1, globalRound: 1 });
    expect(phases[2]).toEqual({ kind: 'recover', label: 'Recover', seconds: 20, round: 1, set: 1, globalRound: 1 });
    expect(phases[phases.length - 1]).toEqual({ kind: 'neutral', label: 'Cool-down', seconds: 60 });
  });

  it('drops the zero-length phases entirely — which is all EMOM is', () => {
    const phases = expandIntervalPhases(singleSetPlan({ workSec: 60, recoverSec: 0, rounds: 3 }));
    expect(phases).toHaveLength(3);
    expect(phases.every((p) => p.kind === 'work')).toBe(true);
    expect(phases.map((p) => p.round)).toEqual([1, 2, 3]);
  });

  it('never carries a round number on warm-up, rest or cool-down — they sit outside the rounds', () => {
    for (const p of expandIntervalPhases(TWO_SETS)) {
      if (p.kind === 'neutral') {
        expect(p.round, p.label).toBeUndefined();
        expect(p.set, p.label).toBeUndefined();
      } else {
        expect(p.round).toBeGreaterThan(0);
      }
    }
  });

  it('inserts ONE rest between two sets — before the second, never before the first or after the last', () => {
    const phases = expandIntervalPhases(TWO_SETS);
    const rests = phases.filter((p) => p.label === 'Rest');
    expect(rests).toHaveLength(1);
    expect(rests.map((r) => r.seconds)).toEqual([90]);
    // 60 warm-up + 12 phases of set 1, then the rest
    expect(phases.findIndex((ph) => ph.label === 'Rest')).toBe(1 + 12);
  });

  it('omits the rest row when there is only one set, whatever the rest value says', () => {
    const one = clampIntervalPlan({ sets: [{ workSec: 20, recoverSec: 10, rounds: 2 }], restBetweenSetsSec: 120 });
    expect(expandIntervalPhases(one).some((p) => p.label === 'Rest')).toBe(false);
    expect(intervalTotalSeconds(one)).toBe(60);
  });

  it('numbers rounds per set for the player AND globally for the log', () => {
    const work = expandIntervalPhases(TWO_SETS).filter((p) => p.kind === 'work');
    expect(work.map((p) => p.round)).toEqual([1, 2, 3, 4, 5, 6, 1, 2, 3, 4]);
    expect(work.map((p) => p.globalRound)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(work.map((p) => p.set)).toEqual([1, 1, 1, 1, 1, 1, 2, 2, 2, 2]);
  });
});

describe('totals', () => {
  it('sums the run including the edges', () => {
    expect(intervalTotalSeconds(HIIT)).toBe(120 + 6 * 60 + 60);
    expect(intervalTotalMinutes(HIIT)).toBe(9);
  });

  it('counts the rest between sets', () => {
    expect(intervalTotalSeconds(TWO_SETS)).toBe(60 + 6 * 60 + 90 + 4 * 60);
    expect(totalRounds(TWO_SETS)).toBe(10);
  });

  it('floors at one minute so a short run never renders as "0 min"', () => {
    expect(intervalTotalMinutes(singleSetPlan({ workSec: 5, recoverSec: 0, rounds: 1 }))).toBe(1);
  });
});

describe('positionAt', () => {
  const phases = expandIntervalPhases(HIIT);

  it('reads the warm-up at t=0, with the first work phase named as next', () => {
    const p = positionAt(phases, 0);
    expect(p.phase.label).toBe('Warm-up');
    expect(p.remaining).toBe(120);
    expect(p.next?.label).toBe('Work');
    expect(p.roundsDone).toBe(0);
  });

  it('lands on the exact phase for a mid-run second (round 3 recover, 12s left)', () => {
    const p = positionAt(phases, 288);
    expect(p.phase.kind).toBe('recover');
    expect(p.phase.round).toBe(3);
    expect(p.remaining).toBe(12);
    expect(p.roundsDone).toBe(2);
  });

  it('is a pure function of elapsed time — a skipped tick cannot desynchronize it', () => {
    expect(positionAt(phases, 288)).toEqual(positionAt(phases, 288));
    expect(positionAt(phases, 318).phase.round).toBe(4);
  });

  it('credits a round only once its LAST phase has ended', () => {
    expect(positionAt(phases, 120 + 40).roundsDone).toBe(0);
    expect(positionAt(phases, 120 + 60).roundsDone).toBe(1);
  });

  it('keeps counting rounds across a set boundary rather than restarting', () => {
    const two = expandIntervalPhases(TWO_SETS);
    // 60 warm-up + set 1 (360) + 90 rest + two finished EMOM rounds = 630
    const at = positionAt(two, 630);
    expect(at.roundsDone).toBe(8);
    expect(at.phase.set).toBe(2);
    expect(at.phase.round).toBe(3);
  });

  it('finishes at the total and reports every round done', () => {
    const p = positionAt(phases, intervalTotalSeconds(HIIT));
    expect(p.done).toBe(true);
    expect(p.roundsDone).toBe(6);
    expect(p.next).toBeUndefined();
  });

  it('is total on an empty list rather than throwing', () => {
    expect(positionAt([], 5).done).toBe(true);
  });
});

describe('roundsCompleted / phaseStartMarks', () => {
  it('counts rounds behind an elapsed mark', () => {
    const phases = expandIntervalPhases(singleSetPlan({ workSec: 20, recoverSec: 10, rounds: 8 }));
    expect(roundsCompleted(phases, 0)).toBe(0);
    expect(roundsCompleted(phases, 90)).toBe(3);
    expect(roundsCompleted(phases, 240)).toBe(8);
  });

  it('marks where each phase begins — the chime schedule', () => {
    const phases = expandIntervalPhases(singleSetPlan({ workSec: 40, recoverSec: 20, rounds: 2 }));
    expect(phaseStartMarks(phases)).toEqual([0, 40, 60, 100]);
  });
});

describe('sets', () => {
  it('adds a HIIT-seeded set and the rest row that goes with it', () => {
    const two = addSet(singleSetPlan({ workSec: 20, recoverSec: 10, rounds: 8 }));
    expect(two.sets).toHaveLength(2);
    expect(setAt(two, 1)).toEqual({ workSec: 40, recoverSec: 20, rounds: 6 });
    expect(two.restBetweenSetsSec).toBe(DEFAULT_REST_BETWEEN_SETS_SEC);
  });

  it('refuses to add past the cap', () => {
    let p = singleSetPlan({ workSec: 20, recoverSec: 10, rounds: 2 });
    for (let i = 0; i < 10; i += 1) p = addSet(p);
    expect(p.sets).toHaveLength(MAX_SETS);
  });

  it('removes a set, but never the last one — delete must not empty the screen', () => {
    expect(removeSet(TWO_SETS, 0).sets).toHaveLength(1);
    expect(setAt(removeSet(TWO_SETS, 0))).toEqual({ workSec: 60, recoverSec: 0, rounds: 4 });
    const one = singleSetPlan({ workSec: 20, recoverSec: 10, rounds: 2 });
    expect(removeSet(one, 0)).toEqual(one);
  });

  it('updates one set and leaves its siblings alone', () => {
    const edited = updateSet(TWO_SETS, 1, { rounds: 8 });
    expect(setAt(edited, 0)).toEqual(setAt(TWO_SETS, 0));
    expect(setAt(edited, 1).rounds).toBe(8);
  });
});

describe('templates', () => {
  it('recognises the familiar shapes by their numbers alone', () => {
    expect(matchTemplate(setAt(HIIT))).toBe('hiit');
    expect(matchTemplate(setAt(singleSetPlan({ workSec: 20, recoverSec: 10, rounds: 8 })))).toBe('tabata');
    expect(matchTemplate(setAt(singleSetPlan({ workSec: 60, recoverSec: 0, rounds: 10 })))).toBe('emom');
    expect(matchTemplate(setAt(singleSetPlan({ workSec: 45, recoverSec: 15, rounds: 5 })))).toBeNull();
    expect(matchTemplate(undefined)).toBeNull();
  });

  it('matches per SET — set 1 can be HIIT while set 2 is something else', () => {
    expect(matchTemplate(setAt(TWO_SETS, 0))).toBe('hiit');
    expect(matchTemplate(setAt(TWO_SETS, 1))).toBeNull(); // 4 rounds, not EMOM's 10
  });

  it('seeds one set and leaves the other sets and the edges alone', () => {
    const seeded = applyTemplate(TWO_SETS, 1, 'tabata');
    expect(setAt(seeded, 0)).toEqual(setAt(TWO_SETS, 0));
    expect(setAt(seeded, 1)).toEqual({ workSec: 20, recoverSec: 10, rounds: 8 });
    expect(seeded.warmupSec).toBe(60);
    expect(seeded.restBetweenSetsSec).toBe(90);
  });

  it('every template round-trips through the clamp untouched', () => {
    for (const t of INTERVAL_TEMPLATES) {
      const plan = singleSetPlan({ workSec: t.workSec, recoverSec: t.recoverSec, rounds: t.rounds });
      expect(matchTemplate(setAt(plan)), t.id).toBe(t.id);
    }
  });
});

describe('words', () => {
  it('states the prescription the way the chip draws it', () => {
    expect(intervalShorthand(HIIT)).toBe('6 × 40/20');
    expect(setShorthand({ workSec: 20, recoverSec: 10, rounds: 8 })).toBe('8 × 20/10');
  });

  it('drops the slash when there is no separate recover', () => {
    expect(intervalShorthand(singleSetPlan({ workSec: 60, recoverSec: 0, rounds: 10 }))).toBe('10 × 1:00');
  });

  it('joins two sets with a plus', () => {
    expect(intervalShorthand(TWO_SETS)).toBe('6 × 40/20 + 4 × 1:00');
  });

  it('logs what happened, never the prescription', () => {
    const run = { totalRounds: 6, targetSec: 540, shorthand: intervalShorthand(HIIT) };
    expect(intervalLogLine({ ...run, roundsDone: 6, elapsedSec: 540 })).toBe('6 × 40/20 · done');
    expect(intervalLogLine({ ...run, roundsDone: 4, elapsedSec: 380 })).toBe('4 of 6 rounds · 6:20 of 9:00');
    expect(intervalLogLine({ ...run, roundsDone: 0, elapsedSec: 30 })).toBe('0 of 6 rounds · 0:30 of 9:00');
  });

  it('describes the run someone EDITED, not the plan they were handed', () => {
    expect(
      intervalLogLine({ roundsDone: 4, totalRounds: 4, elapsedSec: 240, targetSec: 240, shorthand: '4 × 30/30' }),
    ).toBe('4 × 30/30 · done');
  });
});
