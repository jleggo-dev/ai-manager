/**
 * Re-plan routing (PLAN-CHANGES.md Phase 1): with a current plan to evolve, both re-plan entries
 * go through planEvolve (the diff-output path); with nothing to evolve, genesis synthesis runs
 * exactly as before. The synthesis engines themselves are tested in plan-evolve.test.ts — here
 * they are mocked, and what is pinned is WHICH one each flow calls, that stages still fire in
 * order, and that the one-shot commit resolves take-it-or-leave-it items before committing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Goal, PendingPlanActivity } from '@cadence/shared';

const listGoalsByStatus = vi.fn();
const getUser = vi.fn();
const setPendingPlan = vi.fn();
const setPendingProposal = vi.fn();
const listEquipment = vi.fn();
const getActivePlan = vi.fn();
const listActivities = vi.fn();
const listOccurrences = vi.fn();
const listNutritionLogs = vi.fn();
const observedHealthForPlanning = vi.fn();
const sendPlanReadyPush = vi.fn();
const planEvolve = vi.fn();
const planSynthesize = vi.fn();
const planSynthesizeVetCommit = vi.fn();
const commitActivities = vi.fn();
const resolveToggledActivities = vi.fn();
const confirmPendingPlan = vi.fn();

vi.mock('../repos/goals.ts', () => ({ listGoalsByStatus: (...a: unknown[]) => listGoalsByStatus(...a) }));
vi.mock('../repos/users.ts', () => ({
  getUser: (...a: unknown[]) => getUser(...a),
  setPendingPlan: (...a: unknown[]) => setPendingPlan(...a),
  setPendingProposal: (...a: unknown[]) => setPendingProposal(...a),
}));
vi.mock('../repos/equipment.ts', () => ({ listEquipment: (...a: unknown[]) => listEquipment(...a) }));
vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/activities.ts', () => ({ listActivities: (...a: unknown[]) => listActivities(...a) }));
vi.mock('../repos/occurrences.ts', () => ({ listOccurrences: (...a: unknown[]) => listOccurrences(...a) }));
vi.mock('../repos/nutrition.ts', () => ({ listNutritionLogs: (...a: unknown[]) => listNutritionLogs(...a) }));
vi.mock('./observed-health.ts', () => ({
  observedHealthForPlanning: (...a: unknown[]) => observedHealthForPlanning(...a),
  PLAN_COUNTS_NOTE: 'counts note',
}));
vi.mock('./plan-ready-push.ts', () => ({ sendPlanReadyPush: (...a: unknown[]) => sendPlanReadyPush(...a) }));
vi.mock('./plan-evolve.ts', () => ({ planEvolve: (...a: unknown[]) => planEvolve(...a) }));
vi.mock('./plan-fanout.ts', () => ({
  planSynthesize: (...a: unknown[]) => planSynthesize(...a),
  planSynthesizeVetCommit: (...a: unknown[]) => planSynthesizeVetCommit(...a),
}));
vi.mock('./plan-synthesis.ts', () => ({ commitActivities: (...a: unknown[]) => commitActivities(...a) }));
vi.mock('./plan-partial-apply.ts', () => ({
  resolveToggledActivities: (...a: unknown[]) => resolveToggledActivities(...a),
}));
vi.mock('./plan-commit-flow.ts', () => ({ confirmPendingPlan: (...a: unknown[]) => confirmPendingPlan(...a) }));

const { previewReplan, replanPlan } = await import('./replan.ts');

const USER = '00000000-0000-4000-a000-00000000e702';
const GOAL = { goal_id: 'g1', title: 'Run a 10k', area: 'movement', type: 'milestone', status: 'committed' } as Goal;

const PROPOSED: PendingPlanActivity = {
  commitment_id: 'aaaabbbb-1111-4222-8333-444455556666',
  title: 'Easy run',
  kind: 'user',
  cadence: 'Weekly on Tue',
  recurrence: 'FREQ=WEEKLY;BYDAY=TU',
  duration_min: 45,
  completion_source: 'self_report',
  goal_id: 'g1',
};

const withActivePlan = (has: boolean) => {
  getActivePlan.mockResolvedValue(has ? { plan_id: 'p1', version: 3 } : null);
  listActivities.mockResolvedValue(
    has
      ? [
          {
            activity_id: 'row1',
            commitment_id: PROPOSED.commitment_id,
            title: 'Easy run',
            kind: 'user',
            schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU', duration_min: 40 },
            completion_source: 'self_report',
          },
        ]
      : [],
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  listGoalsByStatus.mockResolvedValue([GOAL]);
  getUser.mockResolvedValue({ user_id: USER, baseline: {} });
  listEquipment.mockResolvedValue([]);
  listOccurrences.mockResolvedValue([]);
  listNutritionLogs.mockResolvedValue([]);
  observedHealthForPlanning.mockResolvedValue(null);
  setPendingPlan.mockResolvedValue(undefined);
  setPendingProposal.mockResolvedValue(undefined);
  sendPlanReadyPush.mockResolvedValue(undefined);
  planEvolve.mockResolvedValue({ status: 'proposed', activities: [PROPOSED], note: 'two nudges', rationale: 'r' });
  planSynthesize.mockResolvedValue({ status: 'proposed', activities: [PROPOSED], note: 'built', rationale: 'r' });
  planSynthesizeVetCommit.mockResolvedValue({ status: 'committed', planId: 'p2', version: 1 });
  commitActivities.mockResolvedValue({ status: 'committed', planId: 'p2', version: 4 });
  resolveToggledActivities.mockImplementation(async (_u: unknown, a: unknown) => a);
});

describe('previewReplan routing', () => {
  it('with a current plan, drafts through planEvolve — genesis synthesis is never called', async () => {
    withActivePlan(true);
    const stages: string[] = [];

    const res = await previewReplan(USER, 'one run day is not enough', (s) => stages.push(s));

    expect(res.status).toBe('proposed');
    expect(res.proposal?.note).toBe('two nudges');
    expect(planEvolve).toHaveBeenCalledTimes(1);
    expect(planSynthesize).not.toHaveBeenCalled();
    const [, opts] = planEvolve.mock.calls[0]!;
    expect((opts as { userSteer?: string }).userSteer).toBe('one run day is not enough');
    // The rest of the preview flow is unchanged: pending plan stored, push sent, stages in order.
    expect(setPendingPlan).toHaveBeenCalledWith(USER, expect.objectContaining({ activities: [PROPOSED] }));
    expect(sendPlanReadyPush).toHaveBeenCalled();
    expect(stages).toEqual(['reading', 'drafting', 'saving']);
  });

  it('with no active plan, drafts through planSynthesize — the evolve path needs something to diff against', async () => {
    withActivePlan(false);

    const res = await previewReplan(USER);

    expect(res.status).toBe('proposed');
    expect(planSynthesize).toHaveBeenCalledTimes(1);
    expect(planEvolve).not.toHaveBeenCalled();
  });
});

describe('replanPlan routing (one-shot commit)', () => {
  it('with a current plan, evolves then commits — the fan-out committer is never called', async () => {
    withActivePlan(true);
    const stages: string[] = [];

    const res = await replanPlan(USER, undefined, (s) => stages.push(s));

    expect(res.status).toBe('committed');
    expect(planEvolve).toHaveBeenCalledTimes(1);
    expect(planSynthesizeVetCommit).not.toHaveBeenCalled();
    // Take-it-or-leave-it items get resolved BEFORE the commit — this one-shot flow has no card.
    expect(resolveToggledActivities).toHaveBeenCalledWith(USER, [PROPOSED]);
    expect(commitActivities).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ activities: [PROPOSED], note: 'two nudges', rationale: 'r', goalIds: ['g1'] }),
    );
    // A committed re-plan still clears any lingering proposal banner.
    expect(setPendingProposal).toHaveBeenCalledWith(USER, null);
    expect(stages).toEqual(['reading', 'drafting', 'saving']);
  });

  it('with no active plan, commits through planSynthesizeVetCommit as before', async () => {
    withActivePlan(false);

    const res = await replanPlan(USER);

    expect(res.status).toBe('committed');
    expect(planSynthesizeVetCommit).toHaveBeenCalledTimes(1);
    expect(planEvolve).not.toHaveBeenCalled();
    expect(commitActivities).not.toHaveBeenCalled();
  });

  it('an evolve veto surfaces without committing anything', async () => {
    withActivePlan(true);
    planEvolve.mockResolvedValue({ status: 'vetoed', violations: ['left a goal with nothing'] });

    const res = await replanPlan(USER);

    expect(res).toEqual({ status: 'vetoed', violations: ['left a goal with nothing'] });
    expect(commitActivities).not.toHaveBeenCalled();
    expect(setPendingProposal).not.toHaveBeenCalled();
  });
});
