/**
 * Pure unit tests for the `dated_sessions` merge/dedupe/best/usual_hr rules (W1-3). No database —
 * `buildDatedSessionsPayload` and `workoutTypeMatchesActivity` take plain fixture arrays, per the
 * hard rule that DB-backed tests share the real Cadence database and must never be relied on for
 * logic this cheap to test purely.
 */
import { describe, expect, it } from 'vitest';
import {
  buildDatedSessionsPayload,
  workoutTypeMatchesActivity,
  type PlanSessionInput,
  type WorkoutRowInput,
} from './progress-sessions.ts';

const NOW = new Date('2026-08-29T12:00:00Z').getTime();

const plan = (over: Partial<PlanSessionInput> = {}): PlanSessionInput => ({
  date: '2026-08-20',
  distanceKm: null,
  durationMin: null,
  felt: null,
  ...over,
});

const workout = (over: Partial<WorkoutRowInput> = {}): WorkoutRowInput => ({
  startedAt: '2026-08-20T07:00:00Z',
  distanceKm: null,
  durationMin: null,
  avgHr: null,
  ...over,
});

describe('workoutTypeMatchesActivity', () => {
  it('matches an activity title against a plausible HealthKit type', () => {
    expect(workoutTypeMatchesActivity('Morning Run', 'running')).toBe(true);
    expect(workoutTypeMatchesActivity('Tuesday Long Run', 'run')).toBe(true);
  });

  it('does not match unrelated kinds', () => {
    expect(workoutTypeMatchesActivity('Morning Run', 'yoga')).toBe(false);
    expect(workoutTypeMatchesActivity('Strength — upper', 'running')).toBe(false);
  });

  it('is the safe default (no match) for a title with no recognizable keyword', () => {
    expect(workoutTypeMatchesActivity('Tuesday Session', 'running')).toBe(false);
  });

  it('ignores a workout with no type at all', () => {
    expect(workoutTypeMatchesActivity('Morning Run', '')).toBe(false);
  });
});

describe('buildDatedSessionsPayload — dedupe', () => {
  it('folds a matching workout_history row onto the plan session (auto-tick double-count)', () => {
    // The owner's actual case (PR #296): a watch run auto-ticks the plan occurrence AND leaves a
    // raw workout_history row with the same (rounded) numbers — this must render as ONE session,
    // with the workout row's avg_hr (occurrences never carry it) attached to the surviving row.
    const result = buildDatedSessionsPayload(
      'Morning Run',
      [plan({ date: '2026-08-20', distanceKm: 8.78, durationMin: 77 })],
      [workout({ startedAt: '2026-08-20T07:00:00Z', distanceKm: 8.78, durationMin: 77, avgHr: 148 })],
      NOW,
    );
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ date: '2026-08-20', distance_km: 8.78, duration_min: 77, avg_hr: 148 });
  });

  it('matches within tolerance, not only exact equality', () => {
    const result = buildDatedSessionsPayload(
      'Morning Run',
      [plan({ date: '2026-08-20', distanceKm: 8.8, durationMin: 78 })],
      [workout({ startedAt: '2026-08-20T07:00:00Z', distanceKm: 8.78, durationMin: 77, avgHr: 150 })],
      NOW,
    );
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.avg_hr).toBe(150);
  });

  it('keeps a genuinely unmatched workout row as its own session (the watch saw an unplanned run)', () => {
    const result = buildDatedSessionsPayload(
      'Morning Run',
      [plan({ date: '2026-08-20', distanceKm: 8.78, durationMin: 77 })],
      [workout({ startedAt: '2026-08-22T07:00:00Z', distanceKm: 5.1, durationMin: 30, avgHr: 140 })],
      NOW,
    );
    expect(result.sessions).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('tolerates a same/adjacent-day timezone shift when distance is close', () => {
    // workout_history.started_at is UTC with no per-user timezone in this pure function; a plan
    // date one calendar day off is still trusted when the numbers line up.
    const result = buildDatedSessionsPayload(
      'Morning Run',
      [plan({ date: '2026-08-21', distanceKm: 8.78, durationMin: 77 })],
      [workout({ startedAt: '2026-08-20T23:50:00Z', distanceKm: 8.8, durationMin: 78 })],
      NOW,
    );
    expect(result.sessions).toHaveLength(1);
  });

  it('does not merge across more than a one-day gap even with matching numbers', () => {
    const result = buildDatedSessionsPayload(
      'Morning Run',
      [plan({ date: '2026-08-25', distanceKm: 8.78, durationMin: 77 })],
      [workout({ startedAt: '2026-08-20T07:00:00Z', distanceKm: 8.78, durationMin: 77 })],
      NOW,
    );
    expect(result.sessions).toHaveLength(2);
  });

  it('leaves ambiguous same-day multi-workout rows unmerged when the plan side has no numbers (felt-only)', () => {
    const result = buildDatedSessionsPayload(
      'Morning Run',
      [plan({ date: '2026-08-20', felt: 'right' })],
      [
        workout({ startedAt: '2026-08-20T07:00:00Z', distanceKm: 5, durationMin: 30 }),
        workout({ startedAt: '2026-08-20T18:00:00Z', distanceKm: 3, durationMin: 20 }),
      ],
      NOW,
    );
    // No fuzzy guess between the two candidates — all three stand as separate rows.
    expect(result.sessions).toHaveLength(3);
  });

  it('trusts a felt-only plan session against the SOLE workout row that day', () => {
    const result = buildDatedSessionsPayload(
      'Morning Run',
      [plan({ date: '2026-08-20', felt: 'hard' })],
      [workout({ startedAt: '2026-08-20T07:00:00Z', distanceKm: 5, durationMin: 30, avgHr: 155 })],
      NOW,
    );
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ felt: 'hard', avg_hr: 155, distance_km: 5, duration_min: 30 });
  });
});

describe('buildDatedSessionsPayload — best', () => {
  it('marks the max-distance session as best, and only that one', () => {
    const result = buildDatedSessionsPayload(
      'Morning Run',
      [
        plan({ date: '2026-08-01', distanceKm: 5 }),
        plan({ date: '2026-08-10', distanceKm: 10.2 }),
        plan({ date: '2026-08-15', distanceKm: 7 }),
      ],
      [],
      NOW,
    );
    const bestRows = result.sessions.filter((s) => s.best);
    expect(bestRows).toHaveLength(1);
    expect(bestRows[0]?.date).toBe('2026-08-10');
  });

  it('falls back to max duration when no session has a distance', () => {
    const result = buildDatedSessionsPayload(
      'Yoga',
      [plan({ date: '2026-08-01', durationMin: 30 }), plan({ date: '2026-08-05', durationMin: 60 })],
      [],
      NOW,
    );
    const bestRows = result.sessions.filter((s) => s.best);
    expect(bestRows).toHaveLength(1);
    expect(bestRows[0]?.date).toBe('2026-08-05');
  });

  it('marks nothing best when there is nothing to compare', () => {
    const result = buildDatedSessionsPayload('Morning Run', [plan({ date: '2026-08-01' })], [], NOW);
    expect(result.sessions.some((s) => s.best)).toBe(false);
  });
});

describe('buildDatedSessionsPayload — usual_hr', () => {
  it('is null with fewer than 3 readings', () => {
    const result = buildDatedSessionsPayload(
      'Morning Run',
      [],
      [
        workout({ startedAt: '2026-08-01T07:00:00Z', avgHr: 140 }),
        workout({ startedAt: '2026-08-02T07:00:00Z', avgHr: 150 }),
      ],
      NOW,
    );
    expect(result.usual_hr).toBeNull();
  });

  it('is the median of available readings once there are 3+', () => {
    const result = buildDatedSessionsPayload(
      'Morning Run',
      [],
      [
        workout({ startedAt: '2026-08-01T07:00:00Z', avgHr: 140 }),
        workout({ startedAt: '2026-08-02T07:00:00Z', avgHr: 150 }),
        workout({ startedAt: '2026-08-03T07:00:00Z', avgHr: 160 }),
      ],
      NOW,
    );
    expect(result.usual_hr).toBe(150);
  });
});

describe('buildDatedSessionsPayload — last_4_weeks and ordering', () => {
  it('counts only sessions within the trailing 28 days of `now`', () => {
    const result = buildDatedSessionsPayload(
      'Morning Run',
      [
        plan({ date: '2026-08-25', distanceKm: 5 }), // within 28d of NOW (2026-08-29)
        plan({ date: '2026-07-01', distanceKm: 5 }), // outside
      ],
      [],
      NOW,
    );
    expect(result.last_4_weeks).toBe(1);
  });

  it('returns sessions ascending by date regardless of input order', () => {
    const result = buildDatedSessionsPayload(
      'Morning Run',
      [plan({ date: '2026-08-20' }), plan({ date: '2026-08-01' }), plan({ date: '2026-08-10' })],
      [],
      NOW,
    );
    expect(result.sessions.map((s) => s.date)).toEqual(['2026-08-01', '2026-08-10', '2026-08-20']);
  });
});
