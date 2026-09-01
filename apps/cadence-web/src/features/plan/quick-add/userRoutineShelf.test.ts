/**
 * The "Yours" tier's ranking/capping math — mirrors routineShelf.test.ts's coverage of the coach
 * side, for the user-built routines Activity Builder wave 3 adds.
 */
import { describe, it, expect } from 'vitest';
import { playableUserRoutines, userRoutineMeta } from './userRoutineShelf.ts';
import type { UserRoutine } from '../../../lib/api.ts';

const SESSION_WITH_STEPS = {
  blocks: [{ label: '', items: [{ name: 'Warm-up', duration_min: 5 }] }],
  note: '',
  generated_at: '',
  version: 1,
};
const EMPTY_SESSION = { blocks: [], note: '', generated_at: '', version: 1 };
const BLANK_BLOCK_SESSION = { blocks: [{ label: '', items: [] }], note: '', generated_at: '', version: 1 };

const routine = (over: Partial<UserRoutine> = {}): UserRoutine => ({
  routine_id: 'r1',
  name: 'Hotel HIIT',
  area: 'movement',
  session: SESSION_WITH_STEPS,
  provenance: { kind: 'blank' },
  created_at: '',
  updated_at: '',
  runs: 6,
  last_run: null,
  schedule: null,
  ...over,
});

describe('playableUserRoutines', () => {
  it('keeps a routine whose session actually has steps', () => {
    expect(playableUserRoutines([routine()])).toEqual([routine()]);
  });

  it('drops a routine with no blocks at all', () => {
    expect(playableUserRoutines([routine({ session: EMPTY_SESSION })])).toEqual([]);
  });

  it('drops a routine whose only block is empty — a shell with nothing in it', () => {
    expect(playableUserRoutines([routine({ session: BLANK_BLOCK_SESSION })])).toEqual([]);
  });

  it('a failed read (null) collapses to no rows, the same no-claim every read in this layer draws', () => {
    expect(playableUserRoutines(null)).toEqual([]);
  });

  it('an empty list stays empty — a real answer, not a failure', () => {
    expect(playableUserRoutines([])).toEqual([]);
  });
});

describe('userRoutineMeta', () => {
  it('composes finishes + total minutes, derived from the session — no provenance word', () => {
    expect(userRoutineMeta(routine({ runs: 6, session: SESSION_WITH_STEPS }))).toBe('finished 6 times · 5 min');
  });

  it('never claims "finished 0 times" — a fresh copy nobody has run yet omits that clause', () => {
    expect(userRoutineMeta(routine({ runs: 0, session: SESSION_WITH_STEPS }))).toBe('5 min');
  });

  it('singularizes "1 time"', () => {
    expect(userRoutineMeta(routine({ runs: 1, session: SESSION_WITH_STEPS }))).toBe('finished 1 time · 5 min');
  });

  it('returns null (no meta line at all) when neither fact is real', () => {
    expect(userRoutineMeta(routine({ runs: 0, session: EMPTY_SESSION }))).toBeNull();
  });
});
