/**
 * The words written from facts for the Change sheet (walkthrough v3 Phase 5): count what happened,
 * units spelled, never a reason. Each writer is a small router with a table.
 */
import { describe, expect, it } from 'vitest';
import type { ExerciseHistoryLine, SessionItemAlternative } from '@cadence/shared';
import { alternativeTarget, lastLine, moveTarget, shortDate } from './change-text.ts';
import { targetWord } from './wt-styles.ts';

describe("alternativeTarget — the row's right-hand words, in the header's grammar", () => {
  it.each<[string, SessionItemAlternative, string]>([
    [
      'reps, load, sets',
      { name: 'Kettlebell hip thrust', sets: 2, reps: 12, load: '40 lb', equipment: [] },
      '12 × 40 lb · 2 sets',
    ],
    ['reps, no load', { name: 'Single-leg glute bridge', sets: 2, reps: 10, equipment: [] }, '10 · 2 sets'],
    [
      'timed sets with a load',
      { name: 'Farmer carry', sets: 3, duration_min: 0.75, load: '2×40 lb', equipment: [] },
      '45 s × 2×40 lb · 3 sets',
    ],
    ['a plain hold', { name: 'Wall sit', duration_min: 1, equipment: [] }, '1 min'],
    ['a distance', { name: 'Row', distance_km: 2, equipment: [] }, '2 km'],
    ['nothing quantified', { name: 'Mobility flow', equipment: [] }, ''],
  ])('%s', (_name, alt, expected) => {
    expect(alternativeTarget(alt)).toBe(expected);
  });
});

describe('lastLine — "Last 3 × 10 · 25 lb · Oct 28"', () => {
  const line = (h: Partial<ExerciseHistoryLine>): ExerciseHistoryLine => ({
    date: '2026-10-28',
    activity: 'A',
    name: 'x',
    ...h,
  });
  it.each<[string, Partial<ExerciseHistoryLine>, string]>([
    ['sets, reps, load', { sets: 3, reps: 10, load: '25 lb' }, 'Last 3 × 10 · 25 lb · Oct 28'],
    ['sets and reps, no load', { sets: 2, reps: 10, date: '2026-10-21' }, 'Last 2 × 10 · Oct 21'],
    ['timed sets', { sets: 3, seconds: 30, date: '2026-10-05' }, 'Last 3 × 30 s · Oct 5'],
    ['reps alone', { reps: 8 }, 'Last 8 · Oct 28'],
    ['seconds alone', { seconds: 60 }, 'Last 60 s · Oct 28'],
    ['a load alone', { load: '20 lb' }, 'Last 20 lb · Oct 28'],
    ['only the date', {}, 'Last Oct 28'],
  ])('%s', (_name, h, expected) => {
    expect(lastLine(line(h))).toBe(expected);
  });
});

describe('shortDate', () => {
  it('reads an ISO day as a local day — "Oct 28" never becomes Oct 27 in the Americas', () => {
    expect(shortDate('2026-10-28')).toBe('Oct 28');
    expect(shortDate('2026-01-05')).toBe('Jan 5');
    expect(shortDate('not a date')).toBe('not a date');
  });
});

describe("moveTarget — a circuit move's target, with the weight the person added", () => {
  it.each<[string, Parameters<typeof moveTarget>, string]>([
    ['reps', [{ name: 'x', reps: 12 }], '12 reps'],
    ['reps with a plan load', [{ name: 'x', reps: 12, load: '40 lb' }], '12 reps × 40 lb'],
    ['reps with an added weight over the plan', [{ name: 'x', reps: 12, load: '40 lb' }, '45 lb'], '12 reps × 45 lb'],
    ['seconds', [{ name: 'x', seconds: 30 }], '30 s'],
    ['seconds with an added weight', [{ name: 'x', seconds: 30 }, '15 lb'], '30 s × 15 lb'],
  ])('%s', (_name, args, expected) => {
    expect(moveTarget(...args)).toBe(expected);
  });
});

describe("targetWord — the weight sheet's subtitle number", () => {
  it.each<[Parameters<typeof targetWord>[0], string]>([
    [{ kind: 'reps', sets: 2, reps: 12 }, '12 reps'],
    [{ kind: 'reps', sets: 3 }, '3 sets'],
    [{ kind: 'timer', seconds: 45, sets: 3 }, '45 s'],
    [{ kind: 'read' }, ''],
  ])('%j', (tool, expected) => {
    expect(targetWord(tool)).toBe(expected);
  });
});
