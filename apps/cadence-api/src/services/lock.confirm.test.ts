/**
 * confirmLock's inline-preview fallback is GENESIS-ONLY now (separate from lock.test.ts, whose
 * minimal-mock SR-1 tests exercise the real module graph). With an active plan, a missing
 * pending_plan is the change-card race (applied/dismissed/expired between screens), and the old
 * fallback answered it by silently re-synthesizing the whole week — the "apply my small edit
 * became a rebuild" bug. Onboarding (no active plan) keeps the fallback exactly as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PendingPlan } from '@cadence/shared';

const getUser = vi.fn();
const setPendingPlan = vi.fn(async (..._a: unknown[]) => {});
const getActivePlan = vi.fn();
const listGoalsByStatus = vi.fn();
const setGoalStatus = vi.fn(async (..._a: unknown[]) => {});
const planSynthesize = vi.fn();
const commitActivities = vi.fn();
const sendPlanReadyPush = vi.fn(async (..._a: unknown[]) => {});

vi.mock('../repos/users.ts', () => ({
  getUser: (...a: unknown[]) => getUser(...a),
  setPendingPlan: (...a: unknown[]) => setPendingPlan(...a),
}));
vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/goals.ts', () => ({
  listGoalsByStatus: (...a: unknown[]) => listGoalsByStatus(...a),
  setGoalStatus: (...a: unknown[]) => setGoalStatus(...a),
}));
vi.mock('../repos/equipment.ts', () => ({ listEquipment: vi.fn(async () => []) }));
vi.mock('../repos/activities.ts', () => ({ listActivities: vi.fn(async () => []) }));
vi.mock('./observed-health.ts', () => ({ observedHealthForPlanning: vi.fn(async () => null) }));
vi.mock('./plan-horizon.ts', () => ({ DEFAULT_HORIZON_DAYS: 7 }));
vi.mock('./plan-fanout.ts', () => ({ planSynthesize: (...a: unknown[]) => planSynthesize(...a) }));
vi.mock('./plan-synthesis.ts', () => ({ commitActivities: (...a: unknown[]) => commitActivities(...a) }));
vi.mock('./plan-ready-push.ts', () => ({ sendPlanReadyPush: (...a: unknown[]) => sendPlanReadyPush(...a) }));

const { confirmLock } = await import('./lock.ts');

const USER = '00000000-0000-4000-a000-00000000c203';

function pendingPlan(): PendingPlan {
  return {
    activities: [
      {
        title: 'Easy run',
        kind: 'user',
        cadence: 'Thu',
        recurrence: 'FREQ=WEEKLY;BYDAY=TH',
        completion_source: 'self_report',
      },
    ],
    note: 'first week',
    goal_ids: ['g1'],
    created_at: '2026-08-31T09:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listGoalsByStatus.mockResolvedValue([]);
});

describe('confirmLock', () => {
  it('refuses the change-card race: active plan + no pending_plan → veto, no synthesis', async () => {
    getUser.mockResolvedValue({ pending_plan: null });
    getActivePlan.mockResolvedValue({ plan_id: 'p1', version: 3 });
    const r = await confirmLock(USER);
    expect(r).toEqual({
      status: 'vetoed',
      violations: ['That change card expired — ask me again and I will put it back up.'],
    });
    expect(planSynthesize).not.toHaveBeenCalled();
    expect(commitActivities).not.toHaveBeenCalled();
  });

  it('keeps the genesis fallback: no active plan + no pending_plan still runs the preview inline', async () => {
    getUser.mockResolvedValue({ pending_plan: null });
    getActivePlan.mockResolvedValue(null);
    const r = await confirmLock(USER);
    // No goals confirmed in this setup, so the inline preview vetoes on ITS terms — the point is
    // that it RAN (the onboarding path is untouched), not that it produced a plan here.
    expect(r).toEqual({ status: 'vetoed', violations: ['No confirmed goals to lock.'] });
    expect(listGoalsByStatus).toHaveBeenCalledWith(USER, ['captured']);
  });

  it('commits a pending_plan on file with an active plan present — the normal apply path', async () => {
    getUser.mockResolvedValue({ pending_plan: pendingPlan() });
    getActivePlan.mockResolvedValue({ plan_id: 'p1', version: 1 });
    commitActivities.mockResolvedValue({ status: 'committed', planId: 'p2', version: 2 });
    const r = await confirmLock(USER);
    expect(r.status).toBe('committed');
    expect(commitActivities).toHaveBeenCalledTimes(1);
    expect(setGoalStatus).toHaveBeenCalledWith(USER, 'g1', 'committed');
    expect(setPendingPlan).toHaveBeenCalledWith(USER, null);
    // Version 2 is a rebuild agreed in person — no "first week is ready" ping.
    expect(sendPlanReadyPush).not.toHaveBeenCalled();
  });
});
