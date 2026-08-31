import { describe, expect, it } from 'vitest';
import type { Constraint } from '@cadence/shared';
import { mergeConstraints } from './constraint-merge.ts';

const c = (over: Partial<Constraint> & { label: string }): Constraint => ({
  id: `id-${over.label}`,
  plan_around: true,
  ...over,
});

/**
 * These are the app's memory of what it must not hurt someone with. The first test is the bug
 * that prompted the file: before this merge existed, week three's conversation about a shoulder
 * deleted week one's knee, and the plan built confidently around a knee it no longer knew about.
 */
describe('mergeConstraints', () => {
  const stored = [
    c({ label: 'left knee — patellar tendinopathy', kind: 'physical' }),
    c({ label: 'night shifts', kind: 'life', plan_around: false }),
  ];

  it('never drops what today simply did not come up', () => {
    const merged = mergeConstraints(stored, [c({ label: 'bad shoulder', kind: 'physical' })]);
    expect(merged.map((x) => x.label)).toEqual(['left knee — patellar tendinopathy', 'night shifts', 'bad shoulder']);
  });

  it('updates the same constraint in place instead of adding a second one', () => {
    const merged = mergeConstraints(stored, [c({ label: 'Night Shifts', kind: 'life', plan_around: true })]);
    expect(merged).toHaveLength(2);
    const shifts = merged.find((x) => x.label.toLowerCase().includes('night'))!;
    expect(shifts.plan_around).toBe(true);
    // The id is the thing a fresh capture must not bring — it mints a new uuid every turn.
    expect(shifts.id).toBe('id-night shifts');
  });

  it('lifts a constraint when they say it has settled', () => {
    const merged = mergeConstraints(stored, [
      c({ label: 'left knee — patellar tendinopathy', status: 'quiet', plan_around: false }),
    ]);
    const knee = merged.find((x) => x.label.startsWith('left knee'))!;
    expect(knee.status).toBe('quiet');
    expect(knee.plan_around).toBe(false);
    // Lifted, not forgotten: it stays on file so she can ask about it later.
    expect(merged).toHaveLength(2);
  });

  it('keeps the fuller telling when the same thing is described again', () => {
    const merged = mergeConstraints([c({ label: 'knee' })], [c({ label: 'knee' })]);
    expect(merged[0]!.label).toBe('knee');

    const richer = mergeConstraints([c({ label: 'burnout' })], [c({ label: 'burnout — signed off work' })]);
    expect(richer).toHaveLength(1);
    expect(richer[0]!.label).toBe('burnout — signed off work');
    expect(richer[0]!.id).toBe('id-burnout');
  });

  it('carries a date through, and lets a later telling change it', () => {
    const first = mergeConstraints([], [c({ label: 'away in Lisbon', until: '2026-08-20' })]);
    expect(first[0]!.until).toBe('2026-08-20');
    const extended = mergeConstraints(first, [c({ label: 'away in Lisbon', until: '2026-08-27' })]);
    expect(extended).toHaveLength(1);
    expect(extended[0]!.until).toBe('2026-08-27');
  });

  it('keeps a stored date the new telling is silent about', () => {
    const merged = mergeConstraints(
      [c({ label: 'away', until: '2026-09-01', status: 'active' })],
      [c({ label: 'away' })],
    );
    expect(merged[0]!.until).toBe('2026-09-01');
    expect(merged[0]!.status).toBe('active');
  });

  it('leaves the list alone when nothing was heard', () => {
    expect(mergeConstraints(stored, [])).toEqual(stored);
  });

  it('ignores a blank label rather than storing an empty constraint', () => {
    const merged = mergeConstraints(stored, [c({ label: '   ' })]);
    expect(merged).toHaveLength(2);
  });

  it('updates the earliest match when the stored list already has duplicates', () => {
    const dupes = [c({ id: 'a', label: 'knee' }), c({ id: 'b', label: 'Knee' })];
    const merged = mergeConstraints(dupes, [c({ label: 'knee', plan_around: false })]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.plan_around).toBe(false);
    expect(merged[1]!.plan_around).toBe(true);
  });

  it('does not mutate the stored array it was handed', () => {
    const original = [c({ label: 'knee' })];
    const snapshot = JSON.stringify(original);
    mergeConstraints(original, [c({ label: 'knee', status: 'quiet' })]);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  /**
   * The 2026-08-31 duplicates, verbatim from the owner's file: raw-word containment could not
   * see through a plural or a moved stopword, and one Wednesday became four rows.
   */
  describe('the tellings that actually duplicated (2026-08-31)', () => {
    it('a plural does not split the piano class', () => {
      const merged = mergeConstraints(
        [c({ label: 'Weekly piano class on Saturdays' })],
        [c({ label: 'Saturday piano class' })],
      );
      expect(merged).toHaveLength(1);
      expect(merged[0]!.label).toBe('Weekly piano class on Saturdays');
    });

    it('moved stopwords do not split the Wednesday fact', () => {
      const merged = mergeConstraints(
        [c({ label: 'Wednesday afternoons — at work' })],
        [c({ label: 'work on Wednesday afternoons' })],
      );
      expect(merged).toHaveLength(1);
    });

    it('a fuller retelling lands on the existing row and keeps the longer label', () => {
      const merged = mergeConstraints(
        [c({ label: 'Wednesday afternoons — at work' })],
        [c({ label: 'Wednesday work schedule — can only do one workout, no afternoon workout' })],
      );
      expect(merged).toHaveLength(1);
      expect(merged[0]!.label).toBe('Wednesday work schedule — can only do one workout, no afternoon workout');
    });

    it('different complaints still stay two things', () => {
      const merged = mergeConstraints([c({ label: 'knee pain' })], [c({ label: 'back pain' })]);
      expect(merged).toHaveLength(2);
    });
  });
});
