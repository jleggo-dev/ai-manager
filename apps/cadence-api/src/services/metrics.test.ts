import { describe, it, expect } from 'vitest';
import type { OccurrenceStatus } from '@cadence/shared';
import { rollingConsistency, type ConsistencyOccurrence } from './metrics.ts';

function occ(date: string | Date, status: OccurrenceStatus = 'done'): ConsistencyOccurrence {
  return { date: date as string, status };
}

/** Fixed "today" — Wednesday 2026-07-15 UTC. */
const TODAY = new Date(Date.UTC(2026, 6, 15));

describe('rollingConsistency (brand: never resets to zero)', () => {
  it('counts distinct done days in the window (kept/window)', () => {
    const occurrences = [
      occ('2026-07-15'), // today
      occ('2026-07-14'),
      occ('2026-07-13'),
      occ('2026-07-12'),
      occ('2026-07-11'),
      // 07-10 missed
      occ('2026-07-09'),
    ];
    expect(rollingConsistency(occurrences, TODAY, 7)).toEqual({ kept: 6, window: 7 });
  });

  it('a missed day lowers the ratio — it never resets progress to zero', () => {
    // 4 of 7 kept, then miss today → still 3 of 7, not 0
    const beforeMiss = [occ('2026-07-14'), occ('2026-07-13'), occ('2026-07-12'), occ('2026-07-11')];
    expect(rollingConsistency(beforeMiss, TODAY, 7)).toEqual({ kept: 4, window: 7 });

    // Same history, still no done on today — kept stays 4, never collapses to a "broken streak"
    expect(rollingConsistency(beforeMiss, TODAY, 7).kept).toBeGreaterThan(0);
  });

  it('ignores pending/skipped/missed — only done days count', () => {
    const occurrences = [
      occ('2026-07-15', 'done'),
      occ('2026-07-14', 'pending'),
      occ('2026-07-13', 'skipped'),
      occ('2026-07-12', 'missed'),
      occ('2026-07-11', 'done'),
    ];
    expect(rollingConsistency(occurrences, TODAY, 7)).toEqual({ kept: 2, window: 7 });
  });

  it('counts a day once even with multiple done occurrences that day', () => {
    const occurrences = [
      occ('2026-07-15'),
      occ('2026-07-15'), // second activity same day
      occ('2026-07-14'),
    ];
    expect(rollingConsistency(occurrences, TODAY, 7)).toEqual({ kept: 2, window: 7 });
  });

  it('excludes done days outside the window', () => {
    const occurrences = [
      occ('2026-07-15'),
      occ('2026-07-08'), // 8 days ago — outside a 7-day window ending today
      occ('2026-07-01'),
    ];
    expect(rollingConsistency(occurrences, TODAY, 7)).toEqual({ kept: 1, window: 7 });
  });

  it('normalizes DB Date objects the same as ISO date strings', () => {
    // postgres `date` columns often arrive as JS Date at midnight UTC
    const asDates = [
      occ(new Date(Date.UTC(2026, 6, 15))),
      occ(new Date(Date.UTC(2026, 6, 14))),
      occ(new Date(Date.UTC(2026, 6, 13))),
    ];
    const asStrings = [occ('2026-07-15'), occ('2026-07-14'), occ('2026-07-13')];
    expect(rollingConsistency(asDates, TODAY, 7)).toEqual(rollingConsistency(asStrings, TODAY, 7));
    expect(rollingConsistency(asDates, TODAY, 7)).toEqual({ kept: 3, window: 7 });
  });

  it('returns kept 0 (not a reset flag) when the window is empty', () => {
    expect(rollingConsistency([], TODAY, 7)).toEqual({ kept: 0, window: 7 });
  });

  it('honors a custom windowDays', () => {
    const occurrences = [occ('2026-07-15'), occ('2026-07-14'), occ('2026-07-10')];
    expect(rollingConsistency(occurrences, TODAY, 3)).toEqual({ kept: 2, window: 3 });
  });
});
