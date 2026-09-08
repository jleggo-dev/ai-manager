/**
 * `commitActivities` and the week clock (0058) — a UNIT test of the commit transaction with the
 * repos mocked, beside the real-DB suites (plan-commit.test.ts, plan-commit-invalidation.test.ts)
 * that need a Cadence Postgres. What this pins is the one fact those cannot cheaply: which
 * `week_started_at` the new version is inserted with, per caller.
 *
 *  - an ordinary commit (a proposal accepted, an Adjust, a routine added, a replan, the fan-out)
 *    carries the superseded version's clock forward — the fix for "I still have never been
 *    prompted for a weekly check-in" (owner, 2026-09-07);
 *  - `startsNewWeek: true` (the check-in exits) inserts null, which the repo turns into now();
 *  - a first-ever plan (no predecessor) inserts null too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PendingPlanActivity } from '@cadence/shared';

vi.mock('../config.ts', () => ({
  cadenceConfig: {
    databaseUrl: 'postgresql://mock:mock@mock:5432/mock',
    supabase: { url: '', anonKey: '', serviceRoleKey: '' },
    aim: {},
    commitDiff: false,
  },
}));
vi.mock('../ai/aim.ts', () => ({ runJob: vi.fn(), runJobBySlug: vi.fn() }));
vi.mock('./ai-log.ts', () => ({ logAi: vi.fn() }));
vi.mock('./weather/weather.ts', () => ({ weatherVarsForUser: vi.fn(async () => ({})) }));
vi.mock('./session-generate.ts', () => ({ prefetchImminentSessions: vi.fn(async () => {}) }));
vi.mock('./background.ts', () => ({ runInBackground: vi.fn() }));
vi.mock('./plan-horizon.ts', () => ({ DEFAULT_HORIZON_DAYS: 7, ensureHorizon: vi.fn(async () => 7) }));
vi.mock('../repos/episodes.ts', () => ({ getActiveEpisode: vi.fn(async () => null) }));
vi.mock('../repos/users.ts', () => ({ getUser: vi.fn(async () => ({ timezone: 'UTC' })) }));
vi.mock('../repos/occurrences.ts', () => ({
  deleteFuturePendingOccurrences: vi.fn(async () => 0),
  repointFuturePendingOccurrences: vi.fn(async () => 0),
}));

const getActivePlan = vi.fn();
const insertPlan = vi.fn();
vi.mock('../repos/plans.ts', () => ({
  getActivePlan: (...a: unknown[]) => getActivePlan(...a),
  supersedeActivePlans: vi.fn(async () => {}),
  insertPlan: (...a: unknown[]) => insertPlan(...a),
}));
vi.mock('../repos/activities.ts', () => ({
  listActivities: vi.fn(async () => []),
  insertActivities: vi.fn(async () => []),
}));

// The transaction is the only thing the module needs from db/sql.ts on this path: `sql.begin`
// hands its callback a tx handle the (mocked) repos ignore.
const TX = Symbol('tx');
vi.mock('../db/sql.ts', () => ({
  sql: { begin: async (cb: (tx: unknown) => Promise<unknown>) => cb(TX) },
  json: (v: unknown) => v,
}));

const { commitActivities } = await import('./plan-synthesis.ts');

const WEEK_START = '2026-08-01T12:00:00.000Z';
const OLD_PLAN = {
  plan_id: 'p-old',
  version: 3,
  goal_ids: ['g1'],
  generated_at: '2026-08-05T09:00:00.000Z',
  week_started_at: WEEK_START,
};

const ACTIVITY: PendingPlanActivity = {
  title: 'Easy run',
  kind: 'user',
  cadence: 'Every Tuesday',
  recurrence: 'FREQ=WEEKLY;BYDAY=TU',
  time_of_day: '07:00',
  completion_source: 'self_report',
} as PendingPlanActivity;

/** What the (mocked) insert handed back as the new active plan. */
const inserted = (over: Record<string, unknown> = {}) => ({
  plan_id: 'p-new',
  version: 4,
  generated_at: new Date().toISOString(),
  week_started_at: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  insertPlan.mockImplementation(async (_u: string, plan: Record<string, unknown>) =>
    inserted({ version: plan.version, week_started_at: plan.week_started_at ?? new Date().toISOString() }),
  );
});

const commit = (opts: { startsNewWeek?: boolean } = {}) =>
  commitActivities('u1', { activities: [ACTIVITY], note: 'n', goalIds: ['g1'], ...opts });

describe('commitActivities — the week clock', () => {
  it.each([
    // [label, predecessor, startsNewWeek, week_started_at handed to insertPlan]
    ['an ordinary commit carries the predecessor clock forward', OLD_PLAN, undefined, WEEK_START],
    ['startsNewWeek: false is the ordinary commit, spelled out', OLD_PLAN, false, WEEK_START],
    ['a check-in exit (startsNewWeek: true) hands the repo null → now()', OLD_PLAN, true, null],
    ['a first-ever plan (no predecessor) hands the repo null → now()', null, undefined, null],
    [
      'a pre-0058 predecessor (column null) carries its generated_at as the clock',
      { ...OLD_PLAN, week_started_at: null },
      undefined,
      OLD_PLAN.generated_at,
    ],
  ])('%s', async (_label, old, startsNewWeek, want) => {
    getActivePlan.mockResolvedValue(old);

    const r = await commit(startsNewWeek === undefined ? {} : { startsNewWeek });

    expect(r.status).toBe('committed');
    expect(insertPlan).toHaveBeenCalledTimes(1);
    const [, plan, tx] = insertPlan.mock.calls[0]!;
    expect(plan.week_started_at).toBe(want);
    // The insert runs inside the same transaction as the supersede — the atomicity API-01 exists for.
    expect(tx).toBe(TX);
  });

  it('bumps the version off the predecessor regardless of the clock decision', async () => {
    getActivePlan.mockResolvedValue(OLD_PLAN);
    await commit({ startsNewWeek: true });
    expect(insertPlan.mock.calls[0]![1].version).toBe(4);
  });
});
