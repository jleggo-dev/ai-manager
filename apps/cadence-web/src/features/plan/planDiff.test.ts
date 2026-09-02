import { describe, it, expect } from 'vitest';
import { changesFirst, diffSize, diffWeek } from './planDiff.ts';
import type { WeekRowLike } from './weekGroups.ts';

/**
 * "Show me the diff, and let me click to see the whole plan" (owner, 2026-09-01). The diff is
 * what the person agrees to, so it has to be right in the small cases: a rename is one changed
 * row, not a drop plus an add; a proposal without lineage still pairs by title; a first plan has
 * nothing to compare against and says so.
 */
const row = (over: Partial<WeekRowLike> & { title: string }): WeekRowLike => ({
  recurrence: 'FREQ=WEEKLY;BYDAY=TU',
  cadence: 'Tuesdays',
  time_of_day: '06:00',
  duration_min: 40,
  ...over,
});

const committed: WeekRowLike[] = [
  row({ title: 'Weighted hill intervals (vest or sandbag) + grip finisher', commitment_id: 'c1', activity_id: 'a1' }),
  row({
    title: 'Morning joint mobility & prehab',
    commitment_id: 'c2',
    activity_id: 'a2',
    recurrence: 'FREQ=DAILY',
    duration_min: 10,
  }),
  row({ title: 'Easy run', commitment_id: 'c3', activity_id: 'a3', recurrence: 'FREQ=WEEKLY;BYDAY=TH' }),
];

describe('diffWeek', () => {
  it('a rename is ONE changed row, paired by lineage', () => {
    const proposed = [
      row({ title: 'Hill intervals', commitment_id: 'c1' }),
      row({
        title: 'Morning joint mobility & prehab',
        commitment_id: 'c2',
        recurrence: 'FREQ=DAILY',
        duration_min: 10,
      }),
      row({ title: 'Easy run', commitment_id: 'c3', recurrence: 'FREQ=WEEKLY;BYDAY=TH' }),
    ];
    const d = diffWeek(committed, proposed);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]!.what).toEqual(['renamed']);
    expect(d.changed[0]!.before.title).toMatch(/^Weighted hill/);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.unchanged).toHaveLength(2);
    expect(diffSize(d)).toBe(1);
    expect(changesFirst(d)).toBe(true);
  });

  it('names every kind of change on a row', () => {
    const proposed = [
      row({
        title: 'Easy run',
        commitment_id: 'c3',
        recurrence: 'FREQ=WEEKLY;BYDAY=FR',
        time_of_day: '18:00',
        duration_min: 30,
      }),
    ];
    const d = diffWeek(committed, proposed);
    expect(d.changed[0]!.what).toEqual(['moved', 'retimed', 'resized']);
  });

  it('pairs by title when the proposal carries no lineage', () => {
    const proposed = [row({ title: 'easy run ', recurrence: 'FREQ=WEEKLY;BYDAY=TH' }), row({ title: 'Box breathing' })];
    const d = diffWeek(committed, proposed);
    expect(d.unchanged.map((r) => r.title)).toEqual(['easy run ']);
    expect(d.added.map((r) => r.title)).toEqual(['Box breathing']);
    expect(d.removed.map((r) => r.commitment_id)).toEqual(['c1', 'c2']);
  });

  it('a first plan has nothing to compare against — everything is new, and the whole week opens', () => {
    const d = diffWeek([], [row({ title: 'Easy run' })]);
    expect(d.comparable).toBe(false);
    expect(d.added).toHaveLength(1);
    expect(changesFirst(d)).toBe(false);
  });

  it('a rebuild that keeps nothing opens on the whole week, not a diff that lists it twice', () => {
    const d = diffWeek(committed, [row({ title: 'Swim' }), row({ title: 'Row' })]);
    expect(d.removed).toHaveLength(3);
    expect(d.added).toHaveLength(2);
    expect(changesFirst(d)).toBe(false);
  });

  it('the same week proposed again is no change at all', () => {
    const d = diffWeek(committed, committed);
    expect(diffSize(d)).toBe(0);
    expect(changesFirst(d)).toBe(false);
  });
});
