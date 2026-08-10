import { describe, expect, it } from 'vitest';
import type { DailySteps } from '../../lib/capability/index.ts';
import { summarizeDailySteps } from './steps-summary.ts';

/** `n` consecutive days ending 2026-08-09 (a Sunday), each with `steps`. */
function run(days: number, steps: number, endISO = '2026-08-09'): DailySteps[] {
  const end = Date.parse(`${endISO}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    steps,
  }));
}

describe('summarizeDailySteps', () => {
  it('averages only the days it actually saw', () => {
    // A phone left at home is missing evidence, not a sedentary day. Counting the gap as zero
    // would halve a real person's average and hand the planner a quieter life than they live.
    const s = summarizeDailySteps([
      { date: '2026-08-01', steps: 16000 },
      { date: '2026-08-02', steps: 16000 },
      { date: '2026-08-05', steps: 16000 },
    ])!;
    expect(s.daysObserved).toBe(3);
    expect(s.avgPerDay).toBe(16000);
  });

  it('shows a trailing week that differs from the period average', () => {
    const s = summarizeDailySteps([...run(21, 20000, '2026-08-02'), ...run(7, 8000, '2026-08-09')])!;
    expect(s.avgPerDay).toBeGreaterThan(15000);
    expect(s.avgPerDayLast7).toBe(8000); // the taper is the whole reason this field exists
  });

  it('buckets into Monday-started weeks, oldest first', () => {
    const s = summarizeDailySteps(run(14, 12000, '2026-08-09'))!;
    // 2026-08-09 is a Sunday, so 14 days back spans exactly two Monday-to-Sunday weeks.
    expect(s.byWeek.map((w) => w.weekStartISO)).toEqual(['2026-07-27', '2026-08-03']);
    expect(s.byWeek.every((w) => w.daysObserved === 7)).toBe(true);
    expect(s.byWeek[0]?.avgPerDay).toBe(12000);
  });

  it('keeps the NEWEST weeks when the history is longer than the cap', () => {
    const s = summarizeDailySteps(run(200, 10000, '2026-08-09'))!;
    expect(s.byWeek).toHaveLength(14);
    expect(s.byWeek.at(-1)?.weekStartISO).toBe('2026-08-03'); // the week we plan from
  });

  it('clamps one impossible day instead of rejecting the history', () => {
    // The digest is validated as a whole at the API boundary, so one faulty sensor reading used to
    // cost every other month of data.
    const s = summarizeDailySteps([
      { date: '2026-08-01', steps: 10_000_000 },
      { date: '2026-08-02', steps: 10_000 },
    ])!;
    expect(s.byWeek[0]!.avgPerDay).toBeLessThanOrEqual(200_000);
  });

  it('returns null rather than zeros when nothing was read', () => {
    // "We could not read it" and "they do not move" must stay distinguishable all the way to the
    // planner — one of them is a reason to build a bigger plan.
    expect(summarizeDailySteps([])).toBeNull();
    expect(summarizeDailySteps([{ date: 'garbage', steps: 500 }])).toBeNull();
    expect(summarizeDailySteps([{ date: '2026-08-01', steps: 0 }])).toBeNull();
  });
});
