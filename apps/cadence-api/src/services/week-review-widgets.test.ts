import { describe, it, expect } from 'vitest';
import type { WeekReviewDay } from './week-review-facts.ts';
import { buildMealsWeek, buildSessionsRhythmWeek } from './week-review-widgets.ts';

const PERIOD = { from: '2026-08-17', to: '2026-08-23' };

function day(over: Partial<WeekReviewDay> & { date: string }): WeekReviewDay {
  return {
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

describe('buildSessionsRhythmWeek', () => {
  it('uses the review period verbatim for start/label, never a stand-in', () => {
    const week = buildSessionsRhythmWeek([day({ date: '2026-08-17' })], PERIOD);
    expect(week.start).toBe('2026-08-17');
    expect(week.label).toBe('Aug 17–Aug 23');
  });

  it('reads a day as kept when at least one session that day is done', () => {
    const days = [
      day({ date: '2026-08-17', sessions: [{ occurrence_id: 's1', title: 'Run', status: 'done' }] }),
      day({
        date: '2026-08-18',
        sessions: [
          { occurrence_id: 's2', title: 'Run', status: 'missed' },
          { occurrence_id: 's3', title: 'Lift', status: 'done' },
        ],
      }),
      day({ date: '2026-08-19', sessions: [{ occurrence_id: 's4', title: 'Run', status: 'missed' }] }),
      day({ date: '2026-08-20' }), // nothing scheduled
    ];
    const week = buildSessionsRhythmWeek(days, PERIOD);
    expect(week.days).toEqual([
      { date: '2026-08-17', state: 'kept' },
      { date: '2026-08-18', state: 'kept' }, // one of two done on the day still reads kept
      { date: '2026-08-19', state: 'missed' },
      { date: '2026-08-20', state: 'unscheduled' },
    ]);
  });

  it('kept/scheduled count DAYS, not raw session occurrences (keptScheduledForDays denominator)', () => {
    const days = [
      day({
        date: '2026-08-17',
        sessions: [
          { occurrence_id: 's1', title: 'Run', status: 'done' },
          { occurrence_id: 's2', title: 'Lift', status: 'done' },
        ],
      }),
      day({ date: '2026-08-18', sessions: [{ occurrence_id: 's3', title: 'Run', status: 'missed' }] }),
    ];
    const week = buildSessionsRhythmWeek(days, PERIOD);
    expect(week).toMatchObject({ kept: 1, scheduled: 2 }); // two sessions, one day — still 1 kept day
  });

  it('never carries a detour — the review facts have no episode data to draw one from', () => {
    const week = buildSessionsRhythmWeek([day({ date: '2026-08-17' })], PERIOD);
    expect(week.detour).toBeNull();
  });
});

describe('buildMealsWeek', () => {
  it('reads a day with no materialized meal slot as null ("not read"), never a false zero', () => {
    const week = buildMealsWeek([day({ date: '2026-08-17' })]); // all three occurrence_id: null
    expect(week.weeks).toEqual([{ label: 'Mon', value: null }]);
  });

  it('reads a lived day with nothing logged as a real 0, not "not read"', () => {
    const days = [
      day({
        date: '2026-08-17',
        meals: [
          { meal: 'breakfast', occurrence_id: 'b1', logged: false },
          { meal: 'lunch', occurrence_id: 'l1', logged: false },
          { meal: 'dinner', occurrence_id: 'd1', logged: false },
        ],
      }),
    ];
    expect(buildMealsWeek(days).weeks).toEqual([{ label: 'Mon', value: 0 }]);
  });

  it('counts kept meal slots for a partially-logged day', () => {
    const days = [
      day({
        date: '2026-08-18', // a Tuesday
        meals: [
          { meal: 'breakfast', occurrence_id: 'b1', logged: true },
          { meal: 'lunch', occurrence_id: 'l1', logged: true },
          { meal: 'dinner', occurrence_id: 'd1', logged: false },
        ],
      }),
    ];
    expect(buildMealsWeek(days).weeks).toEqual([{ label: 'Tue', value: 2 }]);
  });

  it('sets latest to the last day in the window', () => {
    const days = [
      day({
        date: '2026-08-17',
        meals: [
          { meal: 'breakfast', occurrence_id: 'b1', logged: true },
          { meal: 'lunch', occurrence_id: 'l1', logged: false },
          { meal: 'dinner', occurrence_id: 'd1', logged: false },
        ],
      }),
      day({ date: '2026-08-18' }), // not materialized
    ];
    expect(buildMealsWeek(days).latest).toBeNull();
  });
});
