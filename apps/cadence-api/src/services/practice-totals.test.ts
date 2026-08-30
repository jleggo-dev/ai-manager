import { describe, it, expect } from 'vitest';
import { aggregatePracticeTotals, type LoggedProgressRow } from './practice-totals.ts';

function row(title: string, value: Record<string, number> | null): LoggedProgressRow {
  return { title, value };
}

describe('aggregatePracticeTotals (extracted from get_practice_totals — same math, two callers)', () => {
  it('sums per (title, metric) across rows and counts sessions', () => {
    const rows = [
      row('Journaling', { words: 400 }),
      row('Journaling', { words: 250 }),
      row('Sitting', { minutes: 20 }),
    ];
    expect(aggregatePracticeTotals(rows)).toEqual([
      { title: 'Journaling', metric: 'words', total: 650, sessions: 2 },
      { title: 'Sitting', metric: 'minutes', total: 20, sessions: 1 },
    ]);
  });

  it('is metric-agnostic — a key this app has never heard of still totals correctly', () => {
    const rows = [row('Piano', { measures_practiced: 12 })];
    expect(aggregatePracticeTotals(rows)).toEqual([
      { title: 'Piano', metric: 'measures_practiced', total: 12, sessions: 1 },
    ]);
  });

  it('ignores non-finite values and null value maps without throwing', () => {
    const rows = [row('Broken', { bad: NaN, ok: 5 }), row('Empty', null)];
    expect(aggregatePracticeTotals(rows)).toEqual([{ title: 'Broken', metric: 'ok', total: 5, sessions: 1 }]);
  });

  it('sorts most-logged first', () => {
    const rows = [row('A', { x: 1 }), row('B', { y: 1 }), row('B', { y: 1 }), row('B', { y: 1 })];
    const totals = aggregatePracticeTotals(rows);
    expect(totals[0]).toMatchObject({ title: 'B', sessions: 3 });
    expect(totals[1]).toMatchObject({ title: 'A', sessions: 1 });
  });
});
