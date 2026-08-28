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
const listOccurrences = vi.fn();
const sendPlanReadyPush = vi.fn();

vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/activities.ts', () => ({
  listActivities: (...a: unknown[]) => listActivities(...a),
  // Mirrors activities.ts's real values — kept in sync by hand since this mock replaces the module.
  NON_PLAN_CATEGORIES: new Set(['adhoc', 'episode', 'menu']),
}));
vi.mock('../repos/occurrences.ts', () => ({ listOccurrences: (...a: unknown[]) => listOccurrences(...a) }));
vi.mock('./plan-synthesis.ts', () => ({ commitActivities: (...a: unknown[]) => commitActivities(...a) }));
vi.mock('./plan-ready-push.ts', () => ({ sendPlanReadyPush: (...a: unknown[]) => sendPlanReadyPush(...a) }));

const { buildNextWeek } = await import('./week-build.ts');

/** Lets the fire-and-forget ready-push chain (never awaited by `buildNextWeek` itself) settle
 *  before assertions run — it is all mocked, microtask-only work, so a macrotask flush is enough. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

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
  // Safe baseline for the fire-and-forget ready-push, so tests that don't care about it never see
  // an unmocked repo call: no user occurrence in the window → the fallback body → a harmless send.
  listOccurrences.mockResolvedValue([]);
  sendPlanReadyPush.mockResolvedValue(undefined);
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

describe('buildNextWeek — the ready push', () => {
  const occurrence = (over: Record<string, unknown> = {}) => ({
    occurrence_id: 'o1',
    activity_id: 'a1',
    date: '2026-08-11', // a Tuesday
    status: 'pending',
    kind: 'user' as const,
    ...over,
  });

  beforeEach(() => {
    getActivePlan.mockResolvedValue(DUE_PLAN);
    commitActivities.mockResolvedValue({
      status: 'committed',
      planId: 'p2',
      version: 4,
      activities: 1,
      occurrences: 7,
    });
  });

  it('composes "first up" from the new week\'s first user-kind occurrence', async () => {
    listActivities.mockResolvedValue([activity()]); // a1, "Easy run", 07:00
    listOccurrences.mockResolvedValue([occurrence()]);

    await buildNextWeek(USER);
    await flush();

    expect(listOccurrences).toHaveBeenCalledWith(USER, expect.any(String), expect.any(String));
    expect(sendPlanReadyPush).toHaveBeenCalledWith(
      USER,
      'checkin_replan_ready',
      'p2',
      'Week 4 is ready',
      'First up: Tuesday, 7 — Easy run.',
    );
  });

  it('skips past a system-kind occurrence (the check-in itself) to the first user one', async () => {
    listActivities.mockResolvedValue([
      activity({ activity_id: 'sys', title: 'Weekly check-in' }),
      activity({ activity_id: 'a1', title: 'Easy run' }),
    ]);
    listOccurrences.mockResolvedValue([
      occurrence({ occurrence_id: 'o0', activity_id: 'sys', date: '2026-08-10', kind: 'system' }),
      occurrence({ occurrence_id: 'o1', activity_id: 'a1', date: '2026-08-11', kind: 'user' }),
    ]);

    await buildNextWeek(USER);
    await flush();

    const [, , , , body] = sendPlanReadyPush.mock.calls[0]!;
    expect(body).toContain('Easy run');
  });

  it('falls back to the calm line when the window has no user-kind occurrence at all', async () => {
    listActivities.mockResolvedValue([activity()]);
    listOccurrences.mockResolvedValue([occurrence({ kind: 'system' })]);

    await buildNextWeek(USER);
    await flush();

    expect(sendPlanReadyPush).toHaveBeenCalledWith(
      USER,
      'checkin_replan_ready',
      'p2',
      'Week 4 is ready',
      "Come take a look when you're ready.",
    );
  });

  it('falls back when the first user occurrence has no clock time', async () => {
    listActivities.mockResolvedValue([
      activity({ activity_id: 'a1', schedule: { recurrence: 'FREQ=DAILY', time_of_day: undefined } }),
    ]);
    listOccurrences.mockResolvedValue([occurrence()]);

    await buildNextWeek(USER);
    await flush();

    const [, , , , body] = sendPlanReadyPush.mock.calls[0]!;
    expect(body).toBe("Come take a look when you're ready.");
  });

  it('still returns the committed result when the ready push throws — the build already landed', async () => {
    listActivities.mockResolvedValue([activity()]);
    listOccurrences.mockRejectedValue(new Error('db down'));

    const r = await buildNextWeek(USER);
    await flush();

    expect(r.status).toBe('committed');
    expect(r.planId).toBe('p2');
  });

  it('never fires the ready push when the guard declines — there is no plan to build from', async () => {
    getActivePlan.mockResolvedValue(null);

    await buildNextWeek(USER);
    await flush();

    expect(sendPlanReadyPush).not.toHaveBeenCalled();
  });
});
