import { beforeEach, describe, expect, it } from 'vitest';
import type { Workout } from '../../lib/capability/index.ts';
import {
  buildDigestFromWorkouts,
  digestIsStale,
  digestsEqual,
  findHealthOfferTurn,
  maybeRefreshHealthDigest,
  toHistoryEntries,
  CHAT_REFRESH_CHECK_KEY,
  CHAT_REFRESH_MIN_INTERVAL_MS,
  CHAT_REFRESH_STALE_MS,
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

/** Fixed clock so the trailing-28-day window is the same one on every run. */
const NOW = Date.parse('2026-08-11T12:00:00Z');

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

  /**
   * The complaint this whole slice answers, in one test: a man training for a 50 km ultra ran
   * 5–6 km five times in a week and was told "you're averaging 4.3 km a run at 36 mins". Both the
   * 90-day mean and the treadmill zeros feeding it were doing exactly what they were built to do.
   */
  it('puts the last four weeks beside the 90-day mean, so a build-up cannot read as a taper', () => {
    const d = buildDigestFromWorkouts(
      [
        // Spring: short, occasional runs — the ones dragging the 90-day mean down.
        run('2026-05-20T08:00:00Z', 3, 25),
        run('2026-06-02T08:00:00Z', 3.4, 27),
        run('2026-06-20T08:00:00Z', 3.6, 28),
        // The past week, which the mean makes invisible.
        run('2026-08-05T06:30:00Z', 5.2, 30),
        run('2026-08-06T06:30:00Z', 5.8, 33),
        run('2026-08-08T06:30:00Z', 4.9, 29),
        run('2026-08-09T06:30:00Z', 6.1, 34),
        run('2026-08-10T06:30:00Z', 5.4, 31),
      ],
      90,
      [],
      NOW,
    );
    const running = d.byType.find((t) => t.type === 'running')!;
    // The flat mean is still there and still not wrong — it was only ever wrong as the ONLY line.
    expect(running.avgDistanceKm).toBeCloseTo(4.7, 1);
    expect(running.last28).toEqual({ count: 5, avgDurationMin: 31.4, avgDistanceKm: 5.5, totalDistanceKm: 27.4 });
  });

  it('reports zero recent sessions rather than omitting the window', () => {
    // A modality someone has not touched in a month is exactly what a 90-day mean hides, and the
    // coach needs it. Absent must keep meaning "this digest predates the field".
    const d = buildDigestFromWorkouts([run('2026-05-20T08:00:00Z', 5, 30)], 90, [], NOW);
    expect(d.byType[0]!.last28).toEqual({
      count: 0,
      avgDurationMin: null,
      avgDistanceKm: null,
      totalDistanceKm: null,
    });
  });

  it('records the longest distance and the longest session, each with its date', () => {
    // A best is the anti-streak: it counts what happened and never resets to zero. Without the
    // date it is not a usable fact — "21 km, back in March" and "21 km last week" size different
    // milestones.
    const d = buildDigestFromWorkouts(
      [run('2026-03-14T08:00:00Z', 21.1, 128), run('2026-08-09T06:30:00Z', 6.1, 34), lift('2026-08-01T18:00:00Z', 55)],
      90,
      [],
      NOW,
    );
    const running = d.byType.find((t) => t.type === 'running')!;
    expect(running.bestDistanceKm).toEqual({ value: 21.1, dateISO: '2026-03-14' });
    expect(running.bestDurationMin).toEqual({ value: 128, dateISO: '2026-03-14' });
    const strength = d.byType.find((t) => t.type === 'strength training')!;
    expect(strength.bestDurationMin).toEqual({ value: 55, dateISO: '2026-08-01' });
    expect(strength.bestDistanceKm).toBeNull(); // lifting has no distance, and never a 0 km one
  });

  it('dates a matched best to the most recent time they did it', () => {
    // "You did that again last week" and "you did that once in March" are different conversations.
    const d = buildDigestFromWorkouts(
      [run('2026-03-14T08:00:00Z', 10, 60), run('2026-08-09T08:00:00Z', 10, 60)],
      90,
      [],
      NOW,
    );
    expect(d.byType[0]!.bestDistanceKm).toEqual({ value: 10, dateISO: '2026-08-09' });
  });

  /**
   * The other half of the 4.3 km: HealthPlugin.swift's `totalDistance ?? 0` makes an indoor run
   * indistinguishable from a 0 km one, and the mean swallows the difference.
   */
  it('treats a 0 km run as a session with no distance, never as zero kilometres', () => {
    const d = buildDigestFromWorkouts(
      [run('2026-08-09T06:30:00Z', 6, 35), run('2026-08-08T18:00:00Z', 0, 40)],
      90,
      [],
      NOW,
    );
    const running = d.byType[0]!;
    expect(running.count).toBe(2); // the treadmill session still HAPPENED — only its distance is gone
    expect(running.avgDistanceKm).toBe(6); // not 3
    expect(running.last28).toMatchObject({ count: 2, totalDistanceKm: 6 });
    expect(d.recent.find((r) => r.start === '2026-08-08T18:00:00Z')).toMatchObject({
      distanceKm: null,
      durationMin: 40,
    });
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

describe('toHistoryEntries', () => {
  it('uses the HealthKit UUID when present, a deterministic composite when not, newest first', () => {
    const entries = toHistoryEntries([
      { type: 'HKWorkoutActivityTypeRunning', start: '2026-08-01T08:00:00Z', durationMin: 30, distanceKm: 5 },
      {
        type: 'HKWorkoutActivityTypeTraditionalStrengthTraining',
        start: '2026-08-03T18:00:00Z',
        durationMin: 45,
        id: 'ABC-123',
        recordedBy: 'Apple Watch',
        avgHr: 132,
      },
    ]);
    expect(entries).toEqual([
      {
        sourceId: 'ABC-123',
        type: 'strength training',
        startISO: '2026-08-03T18:00:00Z',
        durationMin: 45,
        avgHr: 132,
        recordedBy: 'Apple Watch',
      },
      {
        sourceId: '2026-08-01T08:00:00Z|HKWorkoutActivityTypeRunning|30',
        type: 'running',
        startISO: '2026-08-01T08:00:00Z',
        durationMin: 30,
        distanceKm: 5,
      },
    ]);
  });

  it('a 0 km distance is "not recorded", never a real zero — same rule as the digest', () => {
    const [e] = toHistoryEntries([
      { type: 'HKWorkoutActivityTypeRunning', start: '2026-08-01T08:00:00Z', durationMin: 30, distanceKm: 0 },
    ]);
    expect(e).not.toHaveProperty('distanceKm');
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
  /**
   * Built on the SAME pinned clock the deps use, which is the whole point of pinning one.
   *
   * `buildDigestFromWorkouts`'s `nowMs` defaults to the real `Date.now()`, so omitting it here made
   * this fixture drift away from the digest `maybeRefreshHealthDigest` computes (it passes `now()`).
   * The recency figures are measured back from that clock, so once real time had moved far enough
   * from 2026-08-06 the two digests stopped comparing equal and the `unchanged` cases started
   * returning `posted` — a dated time bomb that went off on 2026-08-29, on main, with nobody having
   * touched the file since #213. `health-digest.ts` states the rule this restores: "Same clock the
   * `since` window was cut from, so the recency figures cannot straddle two."
   */
  const digest = buildDigestFromWorkouts(
    [{ type: 'HKWorkoutActivityTypeRunning', distanceKm: 5, durationMin: 30, start: '2026-08-01T08:00:00Z' }],
    90,
    [],
    now(),
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

  /**
   * The in-chat offer is no longer a gate. Requiring it made reading someone's own health data
   * conditional on the coach having said the words "Apple Health" in conversation — miss the
   * phrase and permission was never requested, so the coach promised a prompt that could not
   * appear and read nothing forever (owner, 2026-08-15). iOS already implements the conditional
   * we want: its sheet shows once and answers silently after.
   */
  it('reads without waiting for any in-app offer to have been accepted', async () => {
    expect(await maybeRefreshHealthDigest(deps({}))).toBe('posted');
  });

  it('asks the device for access before reading, every time (idempotent on iOS)', async () => {
    let asked = 0;
    await maybeRefreshHealthDigest(
      deps({
        ensureAccess: async () => {
          asked += 1;
        },
      }),
    );
    expect(asked).toBe(1);
  });

  it('still reads when the access request fails — the read is the real signal', async () => {
    const r = await maybeRefreshHealthDigest(
      deps({
        ensureAccess: async () => {
          throw new Error('denied');
        },
      }),
    );
    expect(r).toBe('posted');
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

  it('pushes workout rows whenever HealthKit was read — even when the digest comes back unchanged', async () => {
    window.localStorage.setItem(HEALTH_OFFER_FLAG_KEY, 'done');
    const pushed: unknown[][] = [];
    const postWorkouts = async (entries: unknown[]) => {
      pushed.push(entries);
      return true;
    };
    // Digest equality would skip the digest POST — the rows must travel anyway, because
    // "digest unchanged" can't prove the rows ever landed (the table may postdate them).
    expect(
      await maybeRefreshHealthDigest(
        deps({
          postWorkouts,
          getLatest: async () => ({ digest: JSON.parse(JSON.stringify(digest)), created_at: '2026-08-01T11:00:00Z' }),
        }),
      ),
    ).toBe('unchanged');
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toEqual([
      {
        sourceId: '2026-08-01T08:00:00Z|HKWorkoutActivityTypeRunning|30',
        type: 'running',
        startISO: '2026-08-01T08:00:00Z',
        durationMin: 30,
        distanceKm: 5,
      },
    ]);
  });

  it('a failed row push never costs the digest', async () => {
    window.localStorage.setItem(HEALTH_OFFER_FLAG_KEY, 'done');
    expect(
      await maybeRefreshHealthDigest(
        deps({
          postWorkouts: async () => {
            throw new Error('endpoint not deployed yet');
          },
        }),
      ),
    ).toBe('posted');
  });

  it('chat tier: its own throttle key, and a 3h-old digest is stale at 2h where the launch tier says fresh', async () => {
    window.localStorage.setItem(HEALTH_OFFER_FLAG_KEY, 'done');
    const threeHoursOld = { digest, created_at: '2026-08-06T09:00:00Z' };
    const tight = {
      staleMs: CHAT_REFRESH_STALE_MS,
      minIntervalMs: CHAT_REFRESH_MIN_INTERVAL_MS,
      throttleKey: CHAT_REFRESH_CHECK_KEY,
    };
    // Launch tier checks first and finds the digest fresh (<24h) — its throttle stamp must not
    // eat the chat-open check that follows.
    expect(await maybeRefreshHealthDigest(deps({ getLatest: async () => threeHoursOld }))).toBe('fresh');
    const fresherWorkouts = async () => [
      { type: 'HKWorkoutActivityTypeRunning', distanceKm: 6, durationMin: 33, start: '2026-08-06T07:00:00Z' },
    ];
    expect(
      await maybeRefreshHealthDigest(
        deps({ ...tight, getLatest: async () => threeHoursOld, getWorkouts: fresherWorkouts }),
      ),
    ).toBe('posted');
    // Second chat-open inside 15min: throttled on the chat key.
    expect(await maybeRefreshHealthDigest(deps(tight))).toBe('skipped');
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
