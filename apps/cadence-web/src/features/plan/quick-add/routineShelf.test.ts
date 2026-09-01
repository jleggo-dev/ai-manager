/**
 * The ranking/capping math behind "Take me on one"'s routines half (Activity Builder 2A) — split
 * out from QuickAddTense.tsx because it is exactly the kind of logic easy to get subtly wrong
 * (an off-by-one in the 5-row cap, an accidental re-sort) without a component in the way.
 */
import { describe, it, expect } from 'vitest';
import { browseAllCount, playableRoutines, routineMeta, shelfRoutines } from './routineShelf.ts';
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

describe('shelfRoutines', () => {
  const three = [
    routine({ commitment_id: 'c1', finishes: 11 }),
    routine({ commitment_id: 'c2', finishes: 6 }),
    routine({ commitment_id: 'c3', finishes: 2 }),
  ];

  it("slices to the top 2 in the API's own order — never re-sorts", () => {
    expect(shelfRoutines(three, 0).map((r) => r.commitment_id)).toEqual(['c1', 'c2']);
  });

  it('now-menu rows claim their slots first — 3 now-menu rows leave room for only 2 routines', () => {
    expect(shelfRoutines(three, 3).map((r) => r.commitment_id)).toEqual(['c1', 'c2']);
  });

  it('never exceeds the shared 5-row cap: 4 now-menu rows leave exactly 1 slot', () => {
    expect(shelfRoutines(three, 4).map((r) => r.commitment_id)).toEqual(['c1']);
  });

  it('a full now-menu (5 rows) leaves no room at all', () => {
    expect(shelfRoutines(three, 5)).toEqual([]);
  });

  it('more now-menu rows than the cap still floors at zero, never a negative slice', () => {
    expect(shelfRoutines(three, 9)).toEqual([]);
  });
});

describe('browseAllCount', () => {
  const three = [routine({ commitment_id: 'c1' }), routine({ commitment_id: 'c2' }), routine({ commitment_id: 'c3' })];

  it('names the FULL playable count, not just the hidden remainder', () => {
    expect(browseAllCount(three, three.slice(0, 2))).toBe(3);
  });

  it('is null once every playable routine is already shown — nothing left to browse', () => {
    expect(browseAllCount(three, three)).toBeNull();
  });

  it('is null for an empty shelf with nothing playable at all', () => {
    expect(browseAllCount([], [])).toBeNull();
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
