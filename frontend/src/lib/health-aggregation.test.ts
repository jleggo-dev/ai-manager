import { describe, expect, it } from 'vitest';
import type { CheckUptimeHistory, UptimeTotals } from '../types/api';
import {
  aggregateUptimeTotals,
  countActiveIncidents,
  formatOverallUptimePercent,
  overallUptimePercent,
  sortHistoryByUptimeAsc,
} from './health-aggregation';

function makeHistory(
  overrides: Partial<CheckUptimeHistory> & Pick<CheckUptimeHistory, 'checkId' | 'checkName'>,
): CheckUptimeHistory {
  return {
    checkType: 'api',
    uptimePercent: null,
    totals: { pass: 0, fail: 0, timeout: 0, error: 0, warning: 0 },
    dailyStats: [],
    ...overrides,
  };
}

describe('aggregateUptimeTotals', () => {
  it('returns zeros for an empty history list', () => {
    expect(aggregateUptimeTotals([])).toEqual({
      pass: 0,
      fail: 0,
      timeout: 0,
      error: 0,
      warning: 0,
    });
  });

  it('sums totals across API and widget checks', () => {
    const history = [
      makeHistory({
        checkId: 'a',
        checkName: 'API',
        checkType: 'api',
        totals: { pass: 10, fail: 1, timeout: 2, error: 0, warning: 3 },
      }),
      makeHistory({
        checkId: 'w',
        checkName: 'Widget',
        checkType: 'widget',
        totals: { pass: 5, fail: 4, timeout: 0, error: 1, warning: 1 },
      }),
    ];

    expect(aggregateUptimeTotals(history)).toEqual({
      pass: 15,
      fail: 5,
      timeout: 2,
      error: 1,
      warning: 4,
    });
  });

  it('treats missing warning as zero', () => {
    const history = [
      makeHistory({
        checkId: 'a',
        checkName: 'API',
        totals: { pass: 1, fail: 0, timeout: 0, error: 0 } as UptimeTotals,
      }),
    ];

    expect(aggregateUptimeTotals(history).warning).toBe(0);
  });
});

describe('sortHistoryByUptimeAsc', () => {
  it('sorts lowest uptime first and leaves the input array untouched', () => {
    const history = [
      makeHistory({ checkId: 'hi', checkName: 'Hi', uptimePercent: 99.5 }),
      makeHistory({ checkId: 'lo', checkName: 'Lo', uptimePercent: 80 }),
      makeHistory({ checkId: 'mid', checkName: 'Mid', uptimePercent: 95 }),
    ];

    const sorted = sortHistoryByUptimeAsc(history);

    expect(sorted.map((h) => h.checkId)).toEqual(['lo', 'mid', 'hi']);
    expect(history.map((h) => h.checkId)).toEqual(['hi', 'lo', 'mid']);
  });

  it('places null uptime after every numeric value', () => {
    const history = [
      makeHistory({ checkId: 'nullish', checkName: 'N/A', uptimePercent: null }),
      makeHistory({ checkId: 'ok', checkName: 'Ok', uptimePercent: 100 }),
    ];

    expect(sortHistoryByUptimeAsc(history).map((h) => h.checkId)).toEqual(['ok', 'nullish']);
  });
});

describe('countActiveIncidents', () => {
  it('counts only items with a truthy activeIncident', () => {
    expect(
      countActiveIncidents([
        { activeIncident: { id: '1' } },
        { activeIncident: null },
        { activeIncident: undefined },
        { activeIncident: { id: '2' } },
      ]),
    ).toBe(2);
  });

  it('returns zero for an empty list', () => {
    expect(countActiveIncidents([])).toBe(0);
  });
});

describe('overallUptimePercent / formatOverallUptimePercent', () => {
  it('returns null / N/A when there are no decisive runs', () => {
    const totals: UptimeTotals = { pass: 0, fail: 0, timeout: 0, error: 0, warning: 9 };
    expect(overallUptimePercent(totals)).toBeNull();
    expect(formatOverallUptimePercent(totals)).toBe('N/A');
  });

  it('excludes warnings from the denominator and rounds to two decimals', () => {
    const totals: UptimeTotals = { pass: 99, fail: 1, timeout: 0, error: 0, warning: 50 };
    expect(overallUptimePercent(totals)).toBe(99);
    expect(formatOverallUptimePercent(totals)).toBe('99.00%');
  });

  it('handles fractional percentages', () => {
    const totals: UptimeTotals = { pass: 1, fail: 2, timeout: 0, error: 0, warning: 0 };
    // 1/3 → 33.333… → round to 33.33
    expect(overallUptimePercent(totals)).toBe(33.33);
    expect(formatOverallUptimePercent(totals)).toBe('33.33%');
  });
});
