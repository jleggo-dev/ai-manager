import { beforeEach, describe, expect, it } from 'vitest';
import type { Workout } from '../../lib/capability/index.ts';
import {
  buildDigestFromWorkouts,
  digestIsStale,
  digestsEqual,
  findHealthOfferTurn,
  maybeRefreshHealthDigest,
  HEALTH_OFFER_FLAG_KEY,
} from './health-digest.ts';

const run = (start: string, km: number, min: number): Workout => ({
  type: 'HKWorkoutActivityTypeRunning',
  distanceKm: km,
  durationMin: min,
  start,
});
const lift = (start: string, min: number): Workout => ({
  type: 'HKWorkoutActivityTypeTraditionalStrengthTraining',
  durationMin: min,
  start,
});

describe('buildDigestFromWorkouts', () => {
  it('aggregates by humanized type with averages and weekly frequency', () => {
    const d = buildDigestFromWorkouts(
      [
        run('2026-07-01T08:00:00Z', 5, 30),
        run('2026-07-08T08:00:00Z', 7, 40),
        run('2026-07-15T08:00:00Z', 6, 35),
        lift('2026-07-05T18:00:00Z', 45),
      ],
      28,
    );
    expect(d.totalWorkouts).toBe(4);
    expect(d.periodDays).toBe(28);
    expect(d.weeklyFrequency).toBe(1); // 4 workouts / 4 weeks
    const running = d.byType.find((t) => t.type === 'running')!;
    expect(running.count).toBe(3);
    expect(running.avgDistanceKm).toBe(6);
    expect(running.avgDurationMin).toBe(35);
    expect(running.lastISO).toBe('2026-07-15T08:00:00Z');
    const strength = d.byType.find((t) => t.type === 'strength training')!;
    expect(strength.count).toBe(1);
    expect(strength.avgDistanceKm).toBeNull();
  });

  it('sorts types by count and recent newest-first, capped at 5', () => {
    const many = Array.from({ length: 9 }, (_, i) => run(`2026-07-0${i + 1}T08:00:00Z`, 5, 30));
    const d = buildDigestFromWorkouts([lift('2026-07-02T18:00:00Z', 45), ...many], 90);
    expect(d.byType[0]?.type).toBe('running');
    expect(d.recent).toHaveLength(5);
    expect(d.recent[0]?.start).toBe('2026-07-09T08:00:00Z');
    expect(d.recent[0]?.type).toBe('running');
  });

  it('carries everyday movement, and omits it entirely when there was none to read', () => {
    // Absent must stay distinguishable from zero all the way to the planner: one of them is a
    // reason to build a bigger plan, the other is a reason to build a smaller one.
    const withSteps = buildDigestFromWorkouts([run('2026-08-01T08:00:00Z', 5, 30)], 90, [
      { date: '2026-08-01', steps: 16000 },
      { date: '2026-08-02', steps: 15000 },
    ]);
    expect(withSteps.dailySteps).toMatchObject({ daysObserved: 2, avgPerDay: 15500 });
    expect(buildDigestFromWorkouts([run('2026-08-01T08:00:00Z', 5, 30)], 90, [])).not.toHaveProperty('dailySteps');
  });

  it('handles the empty case', () => {
    const d = buildDigestFromWorkouts([], 90);
    expect(d.totalWorkouts).toBe(0);
    expect(d.weeklyFrequency).toBe(0);
    expect(d.byType).toEqual([]);
    expect(d.recent).toEqual([]);
  });

  it('never exceeds the server bound of 25 types', () => {
    const zoo = Array.from({ length: 40 }, (_, i) => ({
      type: `HKWorkoutActivityTypeSport${i}`,
      durationMin: 30,
      start: '2026-07-01T08:00:00Z',
    }));
    expect(buildDigestFromWorkouts(zoo, 90).byType).toHaveLength(25);
  });
});

describe('findHealthOfferTurn', () => {
  it('anchors to the LAST coach turn naming Apple Health; user turns never match', () => {
    expect(
      findHealthOfferTurn([
        { role: 'coach', text: 'Want me to look at your Apple Health activity?' },
        { role: 'user', text: 'what is apple health?' },
        { role: 'coach', text: 'I can read your recent workouts from Apple Health — okay?' },
      ]),
    ).toBe(2);
    expect(findHealthOfferTurn([{ role: 'coach', text: 'Tell me about your goal.' }])).toBe(-1);
  });
});

describe('digestIsStale / digestsEqual', () => {
  const now = Date.parse('2026-08-06T12:00:00Z');
  it('stale when missing, unparseable, or older than 24h', () => {
    expect(digestIsStale(null, now)).toBe(true);
    expect(digestIsStale('garbage', now)).toBe(true);
    expect(digestIsStale('2026-08-05T11:00:00Z', now)).toBe(true);
    expect(digestIsStale('2026-08-06T01:00:00Z', now)).toBe(false);
  });
  it('equality ignores key order (jsonb round-trip)', () => {
    expect(digestsEqual({ a: 1, b: [{ x: 1, y: 2 }] }, { b: [{ y: 2, x: 1 }], a: 1 })).toBe(true);
    expect(digestsEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe('maybeRefreshHealthDigest', () => {
  // This jsdom setup has no Storage — give the window a minimal in-memory one.
  const mem = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    },
  });
  const now = () => Date.parse('2026-08-06T12:00:00Z');
  const digest = buildDigestFromWorkouts(
    [{ type: 'HKWorkoutActivityTypeRunning', distanceKm: 5, durationMin: 30, start: '2026-08-01T08:00:00Z' }],
    90,
  );
  const deps = (over: Partial<Parameters<typeof maybeRefreshHealthDigest>[0]>) => ({
    isAvailable: () => true,
    getWorkouts: async () => [
      { type: 'HKWorkoutActivityTypeRunning', distanceKm: 5, durationMin: 30, start: '2026-08-01T08:00:00Z' },
    ],
    getLatest: async () => ({ digest: null, created_at: null }),
    post: async () => true,
    now,
    ...over,
  });

  beforeEach(() => window.localStorage.clear());

  it('skips without granted permission, posts when stale and changed', async () => {
    expect(await maybeRefreshHealthDigest(deps({}))).toBe('skipped');
    window.localStorage.setItem(HEALTH_OFFER_FLAG_KEY, 'done');
    expect(await maybeRefreshHealthDigest(deps({}))).toBe('posted');
  });

  it('throttles repeat checks and respects freshness + content equality', async () => {
    window.localStorage.setItem(HEALTH_OFFER_FLAG_KEY, 'done');
    expect(
      await maybeRefreshHealthDigest(deps({ getLatest: async () => ({ digest, created_at: '2026-08-06T11:00:00Z' }) })),
    ).toBe('fresh');
    // Second call inside the 6h throttle window never hits the server.
    expect(await maybeRefreshHealthDigest(deps({}))).toBe('skipped');
    window.localStorage.removeItem('cadence.healthRefreshAt');
    expect(
      await maybeRefreshHealthDigest(
        deps({
          getLatest: async () => ({ digest: JSON.parse(JSON.stringify(digest)), created_at: '2026-08-01T11:00:00Z' }),
        }),
      ),
    ).toBe('unchanged');
  });

  it('still posts the workouts when the step read fails', async () => {
    // Steps are the newer and more fragile read — a permission existing users were never asked
    // for. Letting a step failure take the refresh down with it would trade a fixed bug for a
    // worse one: no health history at all instead of an incomplete one.
    window.localStorage.setItem(HEALTH_OFFER_FLAG_KEY, 'done');
    expect(
      await maybeRefreshHealthDigest(
        deps({
          getDailySteps: async () => {
            throw new Error('steps permission never granted');
          },
        }),
      ),
    ).toBe('posted');
  });
});

/**
 * The digest is validated as a whole at the API boundary, so anything one workout can do to the
 * payload, it can do to the entire history. Each of these produced a 400, which the user only ever
 * saw as "I couldn't read Apple Health just now".
 */
describe('buildDigestFromWorkouts — one bad workout must not sink the digest', () => {
  it('names a workout HealthKit left untyped', () => {
    const d = buildDigestFromWorkouts([{ type: '', start: '2026-08-01T07:00:00.000Z', durationMin: 30 }]);
    expect(d.byType[0]!.type).toBe('workout');
    expect(d.recent[0]!.type).toBe('workout');
  });

  it('clamps a tracker left running for two days', () => {
    const d = buildDigestFromWorkouts([{ type: 'running', start: '2026-08-01T07:00:00.000Z', durationMin: 4000 }]);
    expect(d.byType[0]!.avgDurationMin).toBe(1440);
    expect(d.recent[0]!.durationMin).toBe(1440);
  });

  it('clamps an implausible distance and drops a non-finite one', () => {
    const d = buildDigestFromWorkouts([
      { type: 'cycling', start: '2026-08-01T07:00:00.000Z', distanceKm: 99_999 },
      { type: 'rowing', start: '2026-08-02T07:00:00.000Z', distanceKm: Number.NaN },
    ]);
    const cycling = d.byType.find((t) => t.type === 'cycling')!;
    const rowing = d.byType.find((t) => t.type === 'rowing')!;
    expect(cycling.avgDistanceKm).toBe(1000);
    expect(rowing.avgDistanceKm).toBeNull();
  });

  it('keeps every type name inside the schema length', () => {
    const d = buildDigestFromWorkouts([{ type: 'x'.repeat(300), start: '2026-08-01T07:00:00.000Z' }]);
    expect(d.byType[0]!.type.length).toBeLessThanOrEqual(80);
  });
});
