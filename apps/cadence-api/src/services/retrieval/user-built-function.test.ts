/**
 * `get_user_built_activities` — the coach's awareness of what the user built (owner ruling
 * 2026-09-01: informed, never approving). The render is the whole cost story: '' when nothing is
 * built (the default user pays nothing on session open), real facts only when something is.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../user-routines.ts', () => ({ listUserRoutines: vi.fn() }));

import { GET_USER_BUILT_ACTIVITIES } from './user-built-function.ts';
import type { UserRoutineView } from '../user-routines.ts';

const routine = (over: Partial<UserRoutineView> = {}): UserRoutineView => ({
  routine_id: 'r1',
  name: 'Hotel HIIT',
  area: 'movement',
  session: {
    blocks: [
      {
        label: '',
        items: [
          { name: 'Warm-up', duration_min: 2 },
          { name: 'Work', duration_min: 8 },
          { name: 'Stretch', duration_min: 2 },
        ],
      },
    ],
    note: '',
    generated_at: '2026-09-01T00:00:00Z',
    version: 1,
  },
  provenance: { kind: 'blank' },
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  runs: 4,
  last_run: '2026-08-30',
  schedule: { days: ['tue', 'fri'], time_of_day: 'evening' },
  ...over,
});

describe('get_user_built_activities render', () => {
  it('renders NOTHING at all when the user has built nothing — the default user pays zero', () => {
    expect(GET_USER_BUILT_ACTIVITIES.render([])).toBe('');
    expect(GET_USER_BUILT_ACTIVITIES.render(undefined)).toBe('');
  });

  it('renders real facts per routine — steps, minutes, runs, schedule — plus the standing rule', () => {
    const out = GET_USER_BUILT_ACTIVITIES.render([routine()]);
    expect(out).toContain('"Hotel HIIT" (movement)');
    expect(out).toContain('steps: Warm-up, Work, Stretch');
    expect(out).toContain('~12 min');
    expect(out).toContain('run 4 times, last 2026-08-30');
    expect(out).toContain('on the plan tue, fri (evening)');
    // The ruling rides the render, word for word where it matters: never rewrite, propose as questions.
    expect(out).toContain('never rewrite their steps');
    expect(out).toContain('propose changes as questions');
  });

  it('says never-run and not-scheduled honestly — no invented numbers, no invented slots', () => {
    const out = GET_USER_BUILT_ACTIVITIES.render([routine({ runs: 0, last_run: null, schedule: null })]);
    expect(out).toContain('never run');
    expect(out).toContain('not scheduled');
    expect(out).not.toContain('run 0');
  });

  it('caps a flood: 12 lines, then a counted remainder — never an unbounded pack section', () => {
    const many = Array.from({ length: 15 }, (_, i) => routine({ routine_id: `r${i}`, name: `Routine ${i}` }));
    const out = GET_USER_BUILT_ACTIVITIES.render(many);
    expect(out).toContain('Routine 11');
    expect(out).not.toContain('Routine 12');
    expect(out).toContain('+3 more in Settings');
  });

  it('rows() reports the honest count for provenance', () => {
    expect(GET_USER_BUILT_ACTIVITIES.rows([routine(), routine()])).toBe(2);
    expect(GET_USER_BUILT_ACTIVITIES.rows(undefined)).toBe(0);
  });
});
