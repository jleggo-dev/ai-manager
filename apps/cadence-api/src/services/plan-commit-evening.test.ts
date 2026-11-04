/**
 * `commitActivities` in the evening — a UNIT test of the real commit, repos mocked, the same
 * harness as plan-commit-week-clock.test.ts but with the commit diff on. The real-DB suites cannot
 * cover this: `generated_at` comes from the database clock, so they cannot stand at 21:56 in
 * Toronto, which is 02:56 UTC the next day.
 *
 * On 2026-11-03 at 21:56 a check-in saved plan v31 and the owner's Tuesday went down to one moved
 * piano session. The new plan was anchored on the UTC date, tomorrow, so every activity with a
 * slot today looked changed and was wiped. What this pins: an unchanged activity keeps today's row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity, PendingPlanActivity } from '@cadence/shared';

vi.mock('../config.ts', () => ({
  cadenceConfig: {
    databaseUrl: 'postgresql://mock:mock@mock:5432/mock',
    supabase: { url: '', anonKey: '', serviceRoleKey: '' },
    aim: {},
    commitDiff: true,
  },
}));
vi.mock('../ai/aim.ts', () => ({ runJob: vi.fn(), runJobBySlug: vi.fn() }));
vi.mock('./ai-log.ts', () => ({ logAi: vi.fn() }));
vi.mock('./weather/weather.ts', () => ({ weatherVarsForUser: vi.fn(async () => ({})) }));
vi.mock('./session-generate.ts', () => ({ prefetchImminentSessions: vi.fn(async () => {}) }));
vi.mock('./background.ts', () => ({ runInBackground: vi.fn() }));
vi.mock('./plan-horizon.ts', () => ({ DEFAULT_HORIZON_DAYS: 7, ensureHorizon: vi.fn(async () => 7) }));
vi.mock('../repos/episodes.ts', () => ({ getActiveEpisode: vi.fn(async () => null) }));

const getUser = vi.fn();
vi.mock('../repos/users.ts', () => ({ getUser: (...a: unknown[]) => getUser(...a) }));

const repoint = vi.fn(async () => 1);
const wipe = vi.fn(async () => 0);
vi.mock('../repos/occurrences.ts', () => ({
  deleteFuturePendingOccurrences: (...a: unknown[]) => wipe(...(a as [])),
  repointFuturePendingOccurrences: (...a: unknown[]) => repoint(...(a as [])),
}));

const getActivePlan = vi.fn();
const insertPlan = vi.fn();
vi.mock('../repos/plans.ts', () => ({
  getActivePlan: (...a: unknown[]) => getActivePlan(...a),
  supersedeActivePlans: vi.fn(async () => {}),
  insertPlan: (...a: unknown[]) => insertPlan(...a),
}));

const listActivities = vi.fn();
const insertActivities = vi.fn();
vi.mock('../repos/activities.ts', () => ({
  listActivities: (...a: unknown[]) => listActivities(...a),
  insertActivities: (...a: unknown[]) => insertActivities(...a),
}));

vi.mock('../db/sql.ts', () => ({
  sql: { begin: async (cb: (tx: unknown) => Promise<unknown>) => cb(Symbol('tx')) },
  json: (v: unknown) => v,
}));

const { commitActivities } = await import('./plan-synthesis.ts');

const SAVED_AT = '2026-11-04T02:56:19.141Z'; // 21:56 Tuesday 3 Nov, America/Toronto

function activity(id: string, planId: string, recurrence: string): Activity {
  return {
    activity_id: id,
    commitment_id: 'c1',
    plan_id: planId,
    goal_id: 'g1',
    title: 'Log breakfast',
    kind: 'system',
    category: 'meal',
    schedule: { recurrence, time_of_day: '08:00' },
    completion_source: 'self_report',
  } as Activity;
}

const PROPOSED = {
  title: 'Log breakfast',
  kind: 'system',
  cadence: 'Every day',
  recurrence: 'FREQ=DAILY',
  time_of_day: '08:00',
  completion_source: 'self_report',
} as PendingPlanActivity;

/** Commit one unchanged activity at SAVED_AT, in the given zone. */
async function commitIn(timezone: string | null, recurrence = 'FREQ=DAILY') {
  getUser.mockResolvedValue({ timezone });
  listActivities.mockResolvedValue([activity('old-a', 'p-old', recurrence)]);
  insertActivities.mockResolvedValue([activity('new-a', 'p-new', recurrence)]);
  await commitActivities('u1', { activities: [{ ...PROPOSED, recurrence }], note: 'n', goalIds: ['g1'] });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(SAVED_AT));
  getActivePlan.mockResolvedValue({
    plan_id: 'p-old',
    version: 30,
    goal_ids: ['g1'],
    generated_at: '2026-11-01T19:48:24.209Z',
    week_started_at: '2026-11-04T02:28:54.543Z',
  });
  insertPlan.mockImplementation(async (_u: string, plan: Record<string, unknown>) => ({
    plan_id: 'p-new',
    version: plan.version,
    generated_at: SAVED_AT,
    week_started_at: '2026-11-04T02:28:54.543Z',
  }));
});

afterEach(() => vi.useRealTimers());

describe('commitActivities — a plan saved in the evening', () => {
  it.each([
    ['a daily activity', 'FREQ=DAILY'],
    ["an activity on today's weekday", 'FREQ=WEEKLY;BYDAY=TU'],
    ['an activity on other days (the piano that was moved onto today)', 'FREQ=WEEKLY;BYDAY=MO,WE,FR'],
  ])("keeps today's row for %s", async (_label, recurrence) => {
    await commitIn('America/Toronto', recurrence);
    expect(repoint).toHaveBeenCalledWith('old-a', 'new-a', '2026-11-03', expect.any(String), expect.anything());
  });

  it('with no zone the UTC floor stands: its day is already tomorrow, so nothing is lost', async () => {
    await commitIn(null);
    expect(repoint).toHaveBeenCalledWith('old-a', 'new-a', '2026-11-04', expect.any(String), expect.anything());
  });
});
