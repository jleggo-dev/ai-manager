/**
 * The ranking/capping math behind "Take me on one"'s routines half (Activity Builder 2A) — split
 * out from QuickAddTense.tsx because it is exactly the kind of logic easy to get subtly wrong
 * (an off-by-one in the 5-row cap, an accidental re-sort) without a component in the way.
 */
import { describe, it, expect } from 'vitest';
import { browseAllCount, fillShelfSlots, playableRoutines, routineMeta } from './routineShelf.ts';
import type { PlanRoutine } from '../../../lib/api.ts';

const routine = (over: Partial<PlanRoutine> = {}): PlanRoutine => ({
  commitment_id: 'c1',
  activity_id: 'act1',
  title: 'Easy 5k',
  area: 'movement',
  steps: ['Warm-up', 'Zone 2', 'Stretch'],
  finishes: 11,
  last_done: null,
  on_plan: true,
  ...over,
});

describe('playableRoutines', () => {
  it('drops a routine with no cached session (steps: []) — it cannot play', () => {
    const playable = routine({ commitment_id: 'p', steps: [] });
    const alive = routine({ commitment_id: 'a', steps: ['Warm-up'] });
    expect(playableRoutines([playable, alive])).toEqual([alive]);
  });

  it('a failed read (null) collapses to no rows, the same no-claim getPlan already draws', () => {
    expect(playableRoutines(null)).toEqual([]);
  });

  it('an empty list stays empty — a real answer, not a failure', () => {
    expect(playableRoutines([])).toEqual([]);
  });
});

describe('fillShelfSlots', () => {
  const three = [
    routine({ commitment_id: 'c1', finishes: 11 }),
    routine({ commitment_id: 'c2', finishes: 6 }),
    routine({ commitment_id: 'c3', finishes: 2 }),
  ];

  it("slices to the top 2 in the API's own order — never re-sorts", () => {
    expect(fillShelfSlots(three, 5).map((r) => r.commitment_id)).toEqual(['c1', 'c2']);
  });

  it('spends only as many slots as are left — 1 remaining leaves exactly 1 shown', () => {
    expect(fillShelfSlots(three, 1).map((r) => r.commitment_id)).toEqual(['c1']);
  });

  it('zero slots remaining leaves nothing shown', () => {
    expect(fillShelfSlots(three, 0)).toEqual([]);
  });

  it('a negative remainder (an earlier tier over-claimed) still floors at zero, never throws', () => {
    expect(fillShelfSlots(three, -2)).toEqual([]);
  });

  it('works over ANY tier, not just PlanRoutine — the caller supplies the type', () => {
    expect(fillShelfSlots(['a', 'b', 'c'], 5)).toEqual(['a', 'b']);
  });
});

describe('browseAllCount', () => {
  it('names the FULL playable count, not just the hidden remainder', () => {
    expect(browseAllCount(3, 2)).toBe(3);
  });

  it('is null once every playable routine, across every tier, is already shown', () => {
    expect(browseAllCount(3, 3)).toBeNull();
  });

  it('is null for an empty shelf with nothing playable at all', () => {
    expect(browseAllCount(0, 0)).toBeNull();
  });

  it('sums across tiers — the caller adds coach + user counts before calling this', () => {
    // 2 coach + 3 user playable, only 2 + 1 shown: 5 total, 3 shown, 2 still hidden.
    expect(browseAllCount(2 + 3, 2 + 1)).toBe(5);
  });
});

describe('routineMeta', () => {
  it('composes finishes + duration + provenance when every fact is real', () => {
    expect(routineMeta(routine({ finishes: 11, duration_min: 32 }))).toBe('finished 11 times · 32 min · from Cadence');
  });

  it('never claims "finished 0 times" — a routine nobody has finished yet omits that clause', () => {
    expect(routineMeta(routine({ finishes: 0, duration_min: 24 }))).toBe('24 min · from Cadence');
  });

  it('omits duration for an off-plan routine — it has no "current" schedule to draw one from', () => {
    expect(routineMeta(routine({ finishes: 6, duration_min: undefined }))).toBe('finished 6 times · from Cadence');
  });

  it('singularizes "1 time" — plain grammar, not a template artifact', () => {
    expect(routineMeta(routine({ finishes: 1, duration_min: undefined }))).toBe('finished 1 time · from Cadence');
  });

  it('"from Cadence" always closes the line, even with nothing else real to say', () => {
    expect(routineMeta(routine({ finishes: 0, duration_min: undefined }))).toBe('from Cadence');
  });
});
