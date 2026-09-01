/**
 * confirmReplan's missing-pending refusal (separate from replan.test.ts, whose minimal-mock
 * SR-1 tests exercise the real module graph). The old behavior on a missing pending_plan was to
 * re-run the whole preview INLINE — a race (the preview dismissed or expired between screens)
 * silently became a minutes-long blocking rebuild. Now it refuses with a veto and the client is
 * told to run the preview again. Everything that could reach a job or the DB is mocked — the
 * refusal path must touch neither.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PendingPlan } from '@cadence/shared';

const getUser = vi.fn();
const setPendingPlan = vi.fn(async (..._a: unknown[]) => {});
const setPendingProposal = vi.fn(async (..._a: unknown[]) => {});
const getActivePlan = vi.fn();
const listActivities = vi.fn();
const planSynthesize = vi.fn();
const planSynthesizeVetCommit = vi.fn();
const commitActivities = vi.fn();
const sendPlanReadyPush = vi.fn(async (..._a: unknown[]) => {});

vi.mock('../repos/users.ts', () => ({
  getUser: (...a: unknown[]) => getUser(...a),
  setPendingPlan: (...a: unknown[]) => setPendingPlan(...a),
  setPendingProposal: (...a: unknown[]) => setPendingProposal(...a),
}));
vi.mock('../repos/goals.ts', () => ({ listGoalsByStatus: vi.fn(async () => []) }));
vi.mock('../repos/equipment.ts', () => ({ listEquipment: vi.fn(async () => []) }));
vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/activities.ts', () => ({ listActivities: (...a: unknown[]) => listActivities(...a) }));
vi.mock('../repos/occurrences.ts', () => ({ listOccurrences: vi.fn(async () => []) }));
vi.mock('../repos/nutrition.ts', () => ({ listNutritionLogs: vi.fn(async () => []) }));
vi.mock('./observed-health.ts', () => ({ observedHealthForPlanning: vi.fn(async () => null), PLAN_COUNTS_NOTE: '' }));
vi.mock('./plan-fanout.ts', () => ({
  planSynthesize: (...a: unknown[]) => planSynthesize(...a),
  planSynthesizeVetCommit: (...a: unknown[]) => planSynthesizeVetCommit(...a),
}));
vi.mock('./plan-synthesis.ts', () => ({ commitActivities: (...a: unknown[]) => commitActivities(...a) }));
vi.mock('./plan-ready-push.ts', () => ({ sendPlanReadyPush: (...a: unknown[]) => sendPlanReadyPush(...a) }));

const { confirmReplan } = await import('./replan.ts');

const USER = '00000000-0000-4000-a000-00000000c202';

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
    note: 'one more run day',
    goal_ids: ['g1'],
    created_at: '2026-08-31T09:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('confirmReplan', () => {
  it('refuses with a veto when no pending_plan is on file — never a silent inline rebuild', async () => {
    getUser.mockResolvedValue({ pending_plan: null });
    const r = await confirmReplan(USER);
    expect(r).toEqual({ status: 'vetoed', violations: ['That adjustment expired — run the preview again.'] });
    // The refusal must not have started any synthesis or committed anything.
    expect(planSynthesize).not.toHaveBeenCalled();
    expect(planSynthesizeVetCommit).not.toHaveBeenCalled();
    expect(commitActivities).not.toHaveBeenCalled();
    expect(setPendingPlan).not.toHaveBeenCalled();
  });

  it('still commits a pending_plan that IS on file, then clears preview + proposal', async () => {
    getUser.mockResolvedValue({ pending_plan: pendingPlan() });
    commitActivities.mockResolvedValue({ status: 'committed', planId: 'p2', version: 2 });
    const r = await confirmReplan(USER);
    expect(r.status).toBe('committed');
    expect(commitActivities).toHaveBeenCalledTimes(1);
    expect(setPendingPlan).toHaveBeenCalledWith(USER, null);
    expect(setPendingProposal).toHaveBeenCalledWith(USER, null);
  });
});
