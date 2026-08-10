import { describe, expect, it, vi } from 'vitest';
import { bucketsToDailySteps, readDailySteps, type StepsReaderDeps } from './health-steps.ts';

const bucket = (startDate: string, value: number) => ({ startDate, endDate: startDate, value });

/**
 * Midday LOCAL on `d`, as the ISO instant the plugin hands back. Written this way on purpose: a
 * step day is the day the person lived through, so the expected date has to be expressed in the
 * device's zone — a hard-coded UTC instant would pass in Lisbon and fail in Auckland.
 */
const day = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y!, m! - 1, dd!, 12, 0, 0).toISOString();
};

describe('bucketsToDailySteps', () => {
  it('sums a day that arrived as several buckets', () => {
    // A phone and a watch both reporting, or a day split across a DST boundary. Replacing rather
    // than summing would silently drop whichever bucket landed first.
    const rows = bucketsToDailySteps([bucket(day('2026-08-01'), 6000), bucket(day('2026-08-01'), 4200)]);
    expect(rows).toEqual([{ date: '2026-08-01', steps: 10200 }]);
  });

  it('sorts oldest first and drops rows it cannot trust', () => {
    const rows = bucketsToDailySteps([
      bucket(day('2026-08-03'), 9000),
      bucket('not-a-date', 5000),
      bucket(day('2026-08-01'), 8000),
      bucket(day('2026-08-02'), Number.NaN),
      bucket(day('2026-08-04'), -12),
    ]);
    expect(rows.map((r) => r.date)).toEqual(['2026-08-01', '2026-08-03']);
  });
});

function deps(over: Partial<StepsReaderDeps> = {}): StepsReaderDeps {
  return {
    queryDailySteps: async () => [bucket(day('2026-08-01'), 16000)],
    requestSteps: async () => undefined,
    hasAskedForSteps: () => false,
    markAskedForSteps: () => {},
    now: () => Date.parse('2026-08-10T12:00:00Z'),
    ...over,
  };
}

/**
 * The whole point of this module. Steps joined the permission set after people had already granted
 * the rest, and HealthKit answers an unauthorized read exactly like an empty one — so "no data"
 * has to trigger one ask, and exactly one.
 */
describe('readDailySteps — the existing-user permission gap', () => {
  it('does not ask again when the first read already returned data', async () => {
    const requestSteps = vi.fn(async () => undefined);
    const rows = await readDailySteps('2026-05-12T00:00:00Z', deps({ requestSteps }));
    expect(rows).toEqual([{ date: '2026-08-01', steps: 16000 }]);
    expect(requestSteps).not.toHaveBeenCalled();
  });

  it('asks once on an empty read and returns what the retry finds', async () => {
    const requestSteps = vi.fn(async () => undefined);
    const marked = vi.fn();
    let call = 0;
    const rows = await readDailySteps(
      '2026-05-12T00:00:00Z',
      deps({
        queryDailySteps: async () => (call++ === 0 ? [] : [bucket(day('2026-08-02'), 15500)]),
        requestSteps,
        markAskedForSteps: marked,
      }),
    );
    expect(requestSteps).toHaveBeenCalledTimes(1);
    expect(marked).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([{ date: '2026-08-02', steps: 15500 }]);
  });

  it('treats an all-zero read as no data, because HealthKit does', async () => {
    const requestSteps = vi.fn(async () => undefined);
    let call = 0;
    await readDailySteps(
      '2026-05-12T00:00:00Z',
      deps({
        queryDailySteps: async () => (call++ === 0 ? [bucket(day('2026-08-01'), 0)] : [bucket(day('2026-08-01'), 900)]),
        requestSteps,
      }),
    );
    expect(requestSteps).toHaveBeenCalled();
  });

  it('never asks a second time — a genuinely step-less person meets no sheet on relaunch', async () => {
    const requestSteps = vi.fn(async () => undefined);
    const rows = await readDailySteps(
      '2026-05-12T00:00:00Z',
      deps({ queryDailySteps: async () => [], requestSteps, hasAskedForSteps: () => true }),
    );
    expect(requestSteps).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });

  it('swallows a throwing plugin on both attempts', async () => {
    // A steps failure that propagated would take down the workout read that shares its caller.
    const rows = await readDailySteps(
      '2026-05-12T00:00:00Z',
      deps({
        queryDailySteps: async () => {
          throw new Error('plugin missing');
        },
        requestSteps: async () => {
          throw new Error('permission sheet refused');
        },
      }),
    );
    expect(rows).toEqual([]);
  });
});
