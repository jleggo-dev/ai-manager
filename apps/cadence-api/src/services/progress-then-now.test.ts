import { describe, expect, it } from 'vitest';
import type { OccurrenceLogItem } from '@cadence/shared';
import { fmtDurationPair, fmtPace, parseLoad, resolveThenNow, type ThenNowSessionRow } from './progress-then-now.ts';

/** Fixed "today" — all fixture dates are relative to this so the 28-day recent window is stable. */
const NOW = new Date('2026-08-31T12:00:00Z');

function row(over: Partial<ThenNowSessionRow> & Pick<ThenNowSessionRow, 'date' | 'title'>): ThenNowSessionRow {
  return { category: null, value: null, log: null, ...over };
}

function itemRow(date: string, title: string, items: Partial<OccurrenceLogItem>[]): ThenNowSessionRow {
  return row({
    date,
    title,
    log: {
      items: items.map((i) => ({ name: 'unnamed', done: true, ...i })),
      summary: '',
      raw_text: '',
      logged_at: `${date}T12:00:00Z`,
    },
  });
}

function runRow(date: string, km: number, min: number): ThenNowSessionRow {
  return row({ date, title: 'Easy run', category: 'run', value: { distance_km: km, duration_min: min } });
}

function sitRow(date: string, min: number): ThenNowSessionRow {
  return row({ date, title: 'Evening sit', category: 'mind', value: { duration_min: min } });
}

describe('formatting', () => {
  it('renders pace as m:ss /km', () => {
    expect(fmtPace(7.8333)).toBe('7:50 /km');
    expect(fmtPace(6.6333)).toBe('6:38 /km');
  });

  it('renders a duration pair in one shared unit — seconds when both are short', () => {
    expect(fmtDurationPair(0.2, 64 / 60)).toEqual({ then: '12 s', now: '64 s' });
    expect(fmtDurationPair(3, 12)).toEqual({ then: '3 min', now: '12 min' });
    expect(fmtDurationPair(2.5, 12)).toEqual({ then: '3 min', now: '12 min' });
  });

  it('parses only unambiguous numeric loads — never a guess', () => {
    expect(parseLoad('20 lb')).toEqual({ v: 20, unit: 'lb' });
    expect(parseLoad('22.5kg')).toEqual({ v: 22.5, unit: 'kg' });
    expect(parseLoad('bodyweight')).toBeNull();
    expect(parseLoad('heavy band')).toBeNull();
    expect(parseLoad(undefined)).toBeNull();
  });
});

describe('resolveThenNow', () => {
  it('omits with evidence when fewer than two honest pairs exist', () => {
    const result = resolveThenNow([], NOW);
    expect(result).toEqual({
      id: 'then_now',
      kind: 'then_now',
      reason: 'fewer than two honest before/after pairs in the logs (found 0)',
    });
  });

  it('binds the design card: a lift, a pace, a hold, a sit', () => {
    const rows: ThenNowSessionRow[] = [
      // Pace: earliest 7:50 /km (Jan 5) vs a 6:38 best inside the last 4 weeks.
      runRow('2026-01-05', 5, 39.17),
      runRow('2026-03-10', 5, 37),
      runRow('2026-05-14', 6, 43),
      runRow('2026-08-10', 5, 34),
      runRow('2026-08-20', 5, 33.17),
      // Lift + hold, item-level.
      itemRow('2026-01-05', 'Obstacle strength', [
        { name: 'Farmer carry', load: '20 lb' },
        { name: 'Grip hang', duration_min: 0.2 },
      ]),
      itemRow('2026-08-25', 'Obstacle strength', [
        { name: 'Farmer carry', load: '50 lb' },
        { name: 'Grip hang', duration_min: 64 / 60 },
      ]),
      // Sit: early window (Jan) vs the last 4 weeks.
      sitRow('2026-01-06', 3),
      sitRow('2026-01-20', 2),
      sitRow('2026-08-24', 12),
    ];
    const result = resolveThenNow(rows, NOW);
    expect(result).toEqual({
      since: '2026-01-05',
      pairs: [
        { label: 'Farmer carry', then: '20 lb', now: '50 lb', area: 'movement' },
        { label: 'Easy run pace', then: '7:50 /km', now: '6:38 /km', area: 'movement' },
        { label: 'Grip hang', then: '12 s', now: '64 s', area: 'movement' },
        { label: 'Longest sit', then: '3 min', now: '12 min', area: 'mind' },
      ],
    });
  });

  it('needs a handful of pace sessions and a recent one — two data points are not a habit', () => {
    const sparse = [runRow('2026-01-05', 5, 40), runRow('2026-08-20', 5, 33)];
    expect('reason' in resolveThenNow(sparse, NOW)).toBe(true);
    // Five sessions but none recent: no honest "now" end.
    const stale = [
      runRow('2026-01-05', 5, 40),
      runRow('2026-01-12', 5, 39),
      runRow('2026-01-19', 5, 39),
      runRow('2026-02-02', 5, 38),
      runRow('2026-02-09', 5, 38),
    ];
    expect('reason' in resolveThenNow(stale, NOW)).toBe(true);
  });

  it('drops a pair whose two ends render identically — no fabricated movement', () => {
    const rows = [
      itemRow('2026-01-05', 'Strength', [
        { name: 'Farmer carry', load: '50 lb' },
        { name: 'Goblet squat', load: '20 lb' },
      ]),
      itemRow('2026-08-25', 'Strength', [
        { name: 'Farmer carry', load: '50 lb' },
        { name: 'Goblet squat', load: '35 lb' },
      ]),
    ];
    const result = resolveThenNow(rows, NOW);
    // Only the squat moved; one honest pair is thinner than the card allows.
    expect(result).toMatchObject({ reason: 'fewer than two honest before/after pairs in the logs (found 1)' });
  });

  it('shows a decline as plainly as a gain — the card states what changed', () => {
    const rows = [
      itemRow('2026-01-05', 'Strength', [
        { name: 'Farmer carry', load: '50 lb' },
        { name: 'Goblet squat', load: '35 lb' },
      ]),
      itemRow('2026-08-25', 'Strength', [
        { name: 'Farmer carry', load: '40 lb' },
        { name: 'Goblet squat', load: '45 lb' },
      ]),
    ];
    const result = resolveThenNow(rows, NOW);
    expect('pairs' in result && result.pairs).toEqual([
      { label: 'Farmer carry', then: '50 lb', now: '40 lb', area: 'movement' },
      { label: 'Goblet squat', then: '35 lb', now: '45 lb', area: 'movement' },
    ]);
  });

  it('never compares loads across units — a unit switch is skipped, not converted', () => {
    const rows = [
      itemRow('2026-01-05', 'Strength', [{ name: 'Deadlift', load: '60 kg' }]),
      itemRow('2026-08-25', 'Strength', [{ name: 'Deadlift', load: '150 lb' }]),
    ];
    expect('reason' in resolveThenNow(rows, NOW)).toBe(true);
  });

  it('reps carry only a never-loaded exercise; a loaded one never falls back to reps', () => {
    const rows = [
      itemRow('2026-01-05', 'Strength', [
        { name: 'Push-ups', reps: 8 },
        { name: 'Rows', load: '20 lb', reps: 8 },
      ]),
      itemRow('2026-08-25', 'Strength', [
        { name: 'Push-ups', reps: 20 },
        { name: 'Rows', load: '30 lb', reps: 12 },
      ]),
    ];
    const result = resolveThenNow(rows, NOW);
    expect('pairs' in result && result.pairs).toEqual([
      // Rows moved 20→30 lb AND 8→12 reps; the load is the measure, reps never double-report it.
      { label: 'Rows', then: '20 lb', now: '30 lb', area: 'movement' },
      { label: 'Push-ups', then: '8 reps', now: '20 reps', area: 'movement' },
    ]);
  });

  it('a sit history younger than eight weeks has no honest "then" window yet', () => {
    const rows = [
      sitRow('2026-07-20', 3),
      sitRow('2026-08-24', 12),
      itemRow('2026-01-05', 'Strength', [
        { name: 'Farmer carry', load: '20 lb' },
        { name: 'Goblet squat', load: '20 lb' },
      ]),
      itemRow('2026-08-25', 'Strength', [
        { name: 'Farmer carry', load: '50 lb' },
        { name: 'Goblet squat', load: '35 lb' },
      ]),
    ];
    const result = resolveThenNow(rows, NOW);
    expect('pairs' in result && result.pairs.map((p) => p.label)).toEqual(['Farmer carry', 'Goblet squat']);
  });

  it('skips undone items and implausible paces', () => {
    const rows = [
      itemRow('2026-01-05', 'Strength', [{ name: 'Farmer carry', load: '20 lb', done: false }]),
      itemRow('2026-08-25', 'Strength', [{ name: 'Farmer carry', load: '50 lb' }]),
      // A "10k in 2 minutes" typo must not seed a pace series.
      runRow('2026-01-05', 10, 2),
      runRow('2026-08-20', 5, 33),
    ];
    expect('reason' in resolveThenNow(rows, NOW)).toBe(true);
  });
});
