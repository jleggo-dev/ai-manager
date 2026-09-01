/**
 * "Pull from Apple Health"'s pure shaping — the filter (three stacked conditions, each easy to
 * get subtly wrong) and the composed facts (never an invented number), tested without mounting
 * the screen.
 */
import { describe, it, expect } from 'vitest';
import { healthPullFacts, healthPullMeta, healthPullSourceLabel, pullableWorkouts } from './healthPull.ts';
import type { WorkoutHistoryListItem } from '../../../lib/api.ts';

const TODAY = '2026-09-01';

/** `startedAt` at a fixed LOCAL hour on `TODAY` — built from local Y/M/D/H/M so the fixture is
 *  correct regardless of the machine's own timezone (the same reasoning `pullableWorkouts` itself
 *  applies via `localTodayIso`). */
const todayAt = (h: number, m = 0) => new Date(2026, 8, 1, h, m, 0).toISOString();
const yesterdayAt = (h: number, m = 0) => new Date(2026, 7, 31, h, m, 0).toISOString();

const row = (over: Partial<WorkoutHistoryListItem> = {}): WorkoutHistoryListItem => ({
  source: 'healthkit',
  type: 'run',
  startedAt: todayAt(7, 2),
  durationMin: 32,
  distanceKm: 4.8,
  avgHr: null,
  ...over,
});

describe('pullableWorkouts', () => {
  it('keeps a device-sourced workout started today, type-matched to the noun', () => {
    expect(pullableWorkouts([row()], 'A run', TODAY)).toEqual([row()]);
  });

  it('excludes a cadence-sourced row — a session already logged through this same screen', () => {
    expect(pullableWorkouts([row({ source: 'cadence' })], 'A run', TODAY)).toEqual([]);
  });

  it('keeps a strava-sourced row too — both device sources are real', () => {
    expect(pullableWorkouts([row({ source: 'strava' })], 'A run', TODAY)).toEqual([row({ source: 'strava' })]);
  });

  it("excludes yesterday's workout — LOCAL calendar, not a rolling 24h window", () => {
    expect(pullableWorkouts([row({ startedAt: yesterdayAt(23, 59) })], 'A run', TODAY)).toEqual([]);
  });

  it('excludes a wrong-type workout under a specific noun ("A run" wants run/jog, not a ride)', () => {
    expect(pullableWorkouts([row({ type: 'ride' })], 'A run', TODAY)).toEqual([]);
  });

  it('a matching type still needs the noun-specific keyword — walk, ride, swim, row each their own', () => {
    expect(pullableWorkouts([row({ type: 'hike' })], 'A walk', TODAY)).toHaveLength(1);
    expect(pullableWorkouts([row({ type: 'cycling' })], 'A ride', TODAY)).toHaveLength(1);
    expect(pullableWorkouts([row({ type: 'swimming' })], 'A swim', TODAY)).toHaveLength(1);
    expect(pullableWorkouts([row({ type: 'rowing' })], 'A row', TODAY)).toHaveLength(1);
  });

  it('the generic "A workout" matches ANY type — it names no specific movement', () => {
    expect(pullableWorkouts([row({ type: 'yoga' })], 'A workout', TODAY)).toHaveLength(1);
    expect(pullableWorkouts([row({ type: 'ride' })], 'A workout', TODAY)).toHaveLength(1);
  });

  it('a wrong-type workout under a specific noun still shows up under the generic noun', () => {
    const rideRow = row({ type: 'ride' });
    expect(pullableWorkouts([rideRow], 'A run', TODAY)).toEqual([]);
    expect(pullableWorkouts([rideRow], 'A workout', TODAY)).toEqual([rideRow]);
  });

  it("preserves the dataset's own order — never re-sorts", () => {
    const a = row({ startedAt: todayAt(6, 0) });
    const b = row({ startedAt: todayAt(9, 0) });
    expect(pullableWorkouts([b, a], 'A run', TODAY)).toEqual([b, a]);
  });
});

describe('healthPullSourceLabel', () => {
  it('names the real brand — never a wrong one', () => {
    expect(healthPullSourceLabel('healthkit')).toBe('Apple Health');
    expect(healthPullSourceLabel('strava')).toBe('Strava');
  });
});

describe('healthPullFacts', () => {
  it('composes distance + duration when both are real', () => {
    expect(healthPullFacts(row({ distanceKm: 4.8, durationMin: 32 }))).toEqual(['4.8 km', '32 min']);
  });

  it('omits distance when absent — never an invented number', () => {
    expect(healthPullFacts(row({ distanceKm: null, durationMin: 20 }))).toEqual(['20 min']);
  });

  it('omits duration when absent', () => {
    expect(healthPullFacts(row({ distanceKm: 5, durationMin: null }))).toEqual(['5 km']);
  });

  it('is empty when neither is real', () => {
    expect(healthPullFacts(row({ distanceKm: null, durationMin: null }))).toEqual([]);
  });

  it('rounds distance to one decimal', () => {
    expect(healthPullFacts(row({ distanceKm: 4.8342, durationMin: null }))).toEqual(['4.8 km']);
  });

  it('rounds duration to a whole minute', () => {
    expect(healthPullFacts(row({ distanceKm: null, durationMin: 31.6 }))).toEqual(['32 min']);
  });
});

describe('healthPullMeta', () => {
  it('joins distance, duration, and the LOCAL start time', () => {
    expect(healthPullMeta(row({ distanceKm: 4.8, durationMin: 32, startedAt: todayAt(7, 2) }))).toBe(
      '4.8 km · 32 min · 7:02 am',
    );
  });

  it('start time always appears, even with no other facts', () => {
    expect(healthPullMeta(row({ distanceKm: null, durationMin: null, startedAt: todayAt(7, 2) }))).toBe('7:02 am');
  });

  it('formats an afternoon time with pm, and drops the leading zero on the hour', () => {
    expect(healthPullMeta(row({ distanceKm: null, durationMin: null, startedAt: todayAt(13, 5) }))).toBe('1:05 pm');
  });

  it('formats noon and midnight as 12, not 0', () => {
    expect(healthPullMeta(row({ distanceKm: null, durationMin: null, startedAt: todayAt(12, 0) }))).toBe('12:00 pm');
    expect(healthPullMeta(row({ distanceKm: null, durationMin: null, startedAt: todayAt(0, 0) }))).toBe('12:00 am');
  });
});
