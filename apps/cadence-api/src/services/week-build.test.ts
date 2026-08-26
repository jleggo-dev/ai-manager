/**
 * "Just build my week — I trust you" (check-in rebuild, step 6): a COMMIT of the outgoing week's
 * own activities, not a synthesis. These tests pin the two things that would silently break the
 * trust path: the guard (no active plan, or the week genuinely isn't over yet) must decline
 * WITHOUT ever calling commitActivities, and the mapping from the committed `Activity` shape
 * (nested `schedule`) to `PendingPlanActivity` (flat fields) must actually round-trip what
 * commitActivities reads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Activity } from '@cadence/shared';

const getActivePlan = vi.fn();
const listActivities = vi.fn();
const commitActivities = vi.fn();

vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/activities.ts', () => ({
  listActivities: (...a: unknown[]) => listActivities(...a),
  // Mirrors activities.ts's real values — kept in sync by hand since this mock replaces the module.
  NON_PLAN_CATEGORIES: new Set(['adhoc', 'episode', 'menu']),
}));
vi.mock('./plan-synthesis.ts', () => ({ commitActivities: (...a: unknown[]) => commitActivities(...a) }));

const { buildNextWeek } = await import('./week-build.ts');

const USER = 'u1';
const DUE_PLAN = {
  plan_id: 'p1',
  goal_ids: ['g1', 'g2'],
  generated_at: new Date(Date.now() - 8 * 86_400_000).toISOString(),
};
const FRESH_PLAN = { plan_id: 'p1', goal_ids: ['g1'], generated_at: new Date().toISOString() };

/** A committed Activity — nested `schedule`, exactly the repo's own shape. */
function activity(over: Partial<Activity> = {}): Activity {
  return {
    activity_id: 'a1',
    commitment_id: 'c1',
    plan_id: 'p1',
    title: 'Easy run',
    kind: 'user',
    category: undefined,
    schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU', time_of_day: '07:00', duration_min: 30 },
    target: { metric: 'distance_km', value: 5 },
    completion_source: 'self_report',
    why: 'Builds the base.',
    goal_id: 'g1',
    ...over,
  } as Activity;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildNextWeek — the guard', () => {
  it('declines with no_plan when there is no active plan, and never calls commitActivities', async () => {
    getActivePlan.mockResolvedValue(null);

    const r = await buildNextWeek(USER);

    expect(r).toEqual({ status: 'no_plan' });
    expect(commitActivities).not.toHaveBeenCalled();
    expect(listActivities).not.toHaveBeenCalled();
  });

  it('declines with not_due when the active plan is not yet a week old, and never calls commitActivities', async () => {
    getActivePlan.mockResolvedValue(FRESH_PLAN);

    const r = await buildNextWeek(USER);

    expect(r).toEqual({ status: 'not_due' });
    expect(commitActivities).not.toHaveBeenCalled();
  });
});

describe('buildNextWeek — the commit', () => {
  it('recommits the same activities, mapped to the flat PendingPlanActivity shape', async () => {
    getActivePlan.mockResolvedValue(DUE_PLAN);
    listActivities.mockResolvedValue([activity()]);
    commitActivities.mockResolvedValue({
      status: 'committed',
      planId: 'p2',
      version: 4,
      activities: 1,
      occurrences: 7,
      note: 'ignored — the service supplies its own',
    });

    await buildNextWeek(USER);

    expect(listActivities).toHaveBeenCalledWith('p1');
    expect(commitActivities).toHaveBeenCalledTimes(1);
    const [userArg, opts] = commitActivities.mock.calls[0]!;
    expect(userArg).toBe(USER);
    expect(opts.goalIds).toEqual(['g1', 'g2']);
    expect(opts.note).toMatch(/rhythm/i);
    expect(opts.activities).toEqual([
      expect.objectContaining({
        commitment_id: 'c1',
        title: 'Easy run',
        kind: 'user',
        recurrence: 'FREQ=WEEKLY;BYDAY=TU',
        time_of_day: '07:00',
        duration_min: 30,
        target: { metric: 'distance_km', value: 5 },
        completion_source: 'self_report',
        goal_id: 'g1',
        why: 'Builds the base.',
      }),
    ]);
    // `cadence` is required on PendingPlanActivity even though commitActivities never reads it.
    expect(opts.activities[0].cadence).toEqual(expect.any(String));
  });

  it('excludes off-plan/episode/menu buckets from what gets recommitted, same as the plan view', async () => {
    getActivePlan.mockResolvedValue(DUE_PLAN);
    listActivities.mockResolvedValue([
      activity({ activity_id: 'a1', title: 'Easy run' }),
      activity({ activity_id: 'a2', title: 'Off-plan', kind: 'system', category: 'adhoc' }),
    ]);
    commitActivities.mockResolvedValue({
      status: 'committed',
      planId: 'p2',
      version: 4,
      activities: 1,
      occurrences: 7,
    });

    await buildNextWeek(USER);

    const [, opts] = commitActivities.mock.calls[0]!;
    expect(opts.activities).toHaveLength(1);
    expect(opts.activities[0].title).toBe('Easy run');
  });

  it('returns the commit result, mapped onto WeekBuildResult', async () => {
    getActivePlan.mockResolvedValue(DUE_PLAN);
    listActivities.mockResolvedValue([activity()]);
    commitActivities.mockResolvedValue({
      status: 'committed',
      planId: 'p2',
      version: 4,
      activities: 1,
      occurrences: 7,
      note: 'Kept your rhythm — building your next week.',
    });

    const r = await buildNextWeek(USER);

    expect(r).toEqual({
      status: 'committed',
      planId: 'p2',
      version: 4,
      activities: 1,
      occurrences: 7,
      note: 'Kept your rhythm — building your next week.',
    });
  });
});
