/**
 * "This exercise, the last N times" (walkthrough v3 Phase 5b). The matcher is a router that fails
 * silently — a near-miss name shows New where there is history, or another move's history under
 * this one — so it gets a table of positives and near-misses like every router in the repo.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const listLoggedOccurrences = vi.fn();
vi.mock('../repos/occurrence-logs.ts', () => ({
  listLoggedOccurrences: (...a: unknown[]) => listLoggedOccurrences(...a),
}));

const { exerciseHistory, sameExercise } = await import('./exercise-history.ts');

const logged = (date: string, title: string, items: Array<Record<string, unknown>>) => ({
  date,
  title,
  log: { items, summary: '', raw_text: '', logged_at: `${date}T12:00:00Z` },
});

describe('sameExercise — accents, case and punctuation fold; other words do not', () => {
  it.each<[string, string, boolean]>([
    ['Glute bridge', 'glute bridge', true],
    ['Écossaise', 'ecossaise', true],
    ['Kettlebell hip-thrust', 'kettlebell hip thrust', true],
    ['Dead hang (chin over bar)', 'dead hang chin over bar', true],
    ['Glute bridge', 'Single-leg glute bridge', false],
    ['Hip thrust', 'Hip thrusts', false],
    ['Row', 'Bent-over row', false],
    ['', 'Row', false],
  ])('%s vs %s → %s', (a, b, expected) => {
    expect(sameExercise(a, b)).toBe(expected);
  });
});

describe('exerciseHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the matching items, newest first, with the facts the sheet writes', async () => {
    listLoggedOccurrences.mockResolvedValue([
      logged('2026-10-28', 'Obstacle strength', [
        { name: 'kettlebell hip thrust', done: true, sets: 3, reps: 10, load: '25 lb' },
        { name: 'glute bridge', done: true, sets: 2, reps: 12, load: 'bodyweight' },
      ]),
      logged('2026-10-21', 'Obstacle strength', [{ name: 'Kettlebell Hip Thrust', done: true, sets: 2, reps: 10 }]),
    ]);
    expect(await exerciseHistory('u1', { exercise: 'Kettlebell hip thrust' })).toEqual([
      {
        date: '2026-10-28',
        activity: 'Obstacle strength',
        name: 'kettlebell hip thrust',
        sets: 3,
        reps: 10,
        load: '25 lb',
      },
      { date: '2026-10-21', activity: 'Obstacle strength', name: 'Kettlebell Hip Thrust', sets: 2, reps: 10 },
    ]);
  });

  it("a timed effort hands back one set's seconds; a swapped item keeps what it replaced", async () => {
    listLoggedOccurrences.mockResolvedValue([
      logged('2026-10-05', 'Grip', [
        { name: 'dead hang', done: true, sets: 3, duration_min: 0.5 },
        { name: 'hip thrust', done: true, sets: 2, reps: 12, load: '40 lb', swapped_from: 'glute bridge' },
      ]),
    ]);
    expect(await exerciseHistory('u1', { exercise: 'Dead hang' })).toEqual([
      { date: '2026-10-05', activity: 'Grip', name: 'dead hang', sets: 3, seconds: 30 },
    ]);
    expect(await exerciseHistory('u1', { exercise: 'hip thrust' })).toEqual([
      {
        date: '2026-10-05',
        activity: 'Grip',
        name: 'hip thrust',
        sets: 2,
        reps: 12,
        load: '40 lb',
        swapped_from: 'glute bridge',
      },
    ]);
  });

  it('an item they said they skipped is not a time they did it; the limit is honoured', async () => {
    listLoggedOccurrences.mockResolvedValue([
      logged('2026-10-28', 'A', [{ name: 'row', done: false, sets: 3 }]),
      logged('2026-10-21', 'A', [{ name: 'row', done: true, sets: 3, reps: 8 }]),
      logged('2026-10-14', 'A', [{ name: 'row', sets: 3, reps: 8 }]),
      logged('2026-10-07', 'A', [{ name: 'row', sets: 3, reps: 8 }]),
    ]);
    const lines = await exerciseHistory('u1', { exercise: 'Row', limit: 2 });
    expect(lines.map((l) => l.date)).toEqual(['2026-10-21', '2026-10-14']);
  });

  it('narrows to one activity when asked, and asks for nothing on a blank name', async () => {
    listLoggedOccurrences.mockResolvedValue([]);
    await exerciseHistory('u1', { exercise: 'Row', activity: 'Obstacle strength' });
    expect(listLoggedOccurrences).toHaveBeenCalledWith('u1', { title: 'Obstacle strength', limit: 200 });
    expect(await exerciseHistory('u1', { exercise: '  ' })).toEqual([]);
  });
});
