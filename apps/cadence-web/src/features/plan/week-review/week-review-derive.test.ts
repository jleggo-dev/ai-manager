import { describe, it, expect } from 'vitest';
import type { WeekReviewDay, WeekReviewMindRow } from '../../../lib/api.ts';
import { dayCompletion, mealsRollup, mindRowKept, mindsetRollup, sessionsRollup } from './week-review-derive.ts';

function day(over: Partial<WeekReviewDay> = {}): WeekReviewDay {
  return {
    date: '2026-08-17',
    sessions: [],
    meals: [
      { meal: 'breakfast', occurrence_id: null, logged: false },
      { meal: 'lunch', occurrence_id: null, logged: false },
      { meal: 'dinner', occurrence_id: null, logged: false },
    ],
    mind: [],
    ...over,
  };
}

describe('mindRowKept', () => {
  it('is kept when every named step is done', () => {
    const row: WeekReviewMindRow = {
      occurrence_id: 'o1',
      title: 'Evening pages',
      status: 'pending',
      steps: [
        { name: 'Settle', done: true },
        { name: 'Write', done: true },
      ],
    };
    expect(mindRowKept(row)).toBe(true);
  });

  it('is not kept when any named step is left undone', () => {
    const row: WeekReviewMindRow = {
      occurrence_id: 'o1',
      title: 'Evening pages',
      status: 'pending',
      steps: [
        { name: 'Settle', done: true },
        { name: 'Write', done: false },
      ],
    };
    expect(mindRowKept(row)).toBe(false);
  });

  it('falls back to the plain done flag with no named steps', () => {
    const doneRow: WeekReviewMindRow = { occurrence_id: 'o1', title: 'Sit', status: 'done', done: true };
    const pendingRow: WeekReviewMindRow = { occurrence_id: 'o2', title: 'Sit', status: 'pending', done: false };
    expect(mindRowKept(doneRow)).toBe(true);
    expect(mindRowKept(pendingRow)).toBe(false);
  });

  it('an empty steps array is not kept (nothing named, nothing to have done)', () => {
    const row: WeekReviewMindRow = { occurrence_id: 'o1', title: 'Sit', status: 'pending', steps: [] };
    expect(mindRowKept(row)).toBe(false);
  });
});

describe('dayCompletion', () => {
  it('is empty (0/0), not shameful, for a rest day with nothing scheduled', () => {
    expect(dayCompletion(day({ meals: [] }))).toEqual({ kept: 0, total: 0 });
  });

  it('sums sessions done + meals logged + mind rows kept over everything scheduled', () => {
    const d = day({
      sessions: [
        { occurrence_id: 's1', title: 'Easy run', status: 'done' },
        { occurrence_id: 's2', title: 'Mobility', status: 'pending' },
      ],
      meals: [
        { meal: 'breakfast', occurrence_id: 'm1', logged: true },
        { meal: 'lunch', occurrence_id: 'm2', logged: false },
        { meal: 'dinner', occurrence_id: null, logged: false },
      ],
      mind: [{ occurrence_id: 'g1', title: 'Sit', status: 'done', done: true }],
    });
    // kept: 1 session + 1 meal + 1 mind = 3; total: 2 sessions + 3 meals + 1 mind = 6
    expect(dayCompletion(d)).toEqual({ kept: 3, total: 6 });
  });
});

describe('week rollups', () => {
  const WEEK: WeekReviewDay[] = [
    day({
      date: '2026-08-17',
      meals: [
        { meal: 'breakfast', occurrence_id: 'm1', logged: true },
        { meal: 'lunch', occurrence_id: 'm2', logged: true },
        { meal: 'dinner', occurrence_id: 'm3', logged: false },
      ],
      sessions: [{ occurrence_id: 's1', title: 'Easy run', status: 'done' }],
    }),
    day({
      date: '2026-08-18',
      meals: [
        { meal: 'breakfast', occurrence_id: 'm4', logged: false },
        { meal: 'lunch', occurrence_id: 'm5', logged: true },
        { meal: 'dinner', occurrence_id: 'm6', logged: true },
      ],
      sessions: [{ occurrence_id: 's2', title: 'Strength', status: 'missed' }],
    }),
  ];

  it('meals: kept/total across the whole week, fixed 3-per-day slots', () => {
    expect(mealsRollup(WEEK)).toEqual({ kept: 4, total: 6 });
  });

  it('sessions: only status done counts as kept', () => {
    expect(sessionsRollup(WEEK)).toEqual({ kept: 1, total: 2 });
  });

  it('mindset: 0/0 (absent) for a week with no mind/practice rows at all', () => {
    expect(mindsetRollup(WEEK)).toEqual({ kept: 0, total: 0 });
  });

  it('mindset: counts rows kept by mindRowKept, over every mind row in the week', () => {
    const withMind: WeekReviewDay[] = [
      day({ mind: [{ occurrence_id: 'g1', title: 'Sit', status: 'done', done: true }] }),
      day({ mind: [{ occurrence_id: 'g2', title: 'Sit', status: 'pending', done: false }] }),
    ];
    expect(mindsetRollup(withMind)).toEqual({ kept: 1, total: 2 });
  });
});
