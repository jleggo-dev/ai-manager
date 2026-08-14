import { beforeEach, describe, expect, it, vi } from 'vitest';

const getActivePlan = vi.fn();
const listActivities = vi.fn();
const listGoalsByStatus = vi.fn();
const setPendingPlan = vi.fn();
const commitActivities = vi.fn();

vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/activities.ts', () => ({ listActivities: (...a: unknown[]) => listActivities(...a) }));
vi.mock('../repos/goals.ts', () => ({ listGoalsByStatus: (...a: unknown[]) => listGoalsByStatus(...a) }));
vi.mock('../repos/users.ts', () => ({ setPendingPlan: (...a: unknown[]) => setPendingPlan(...a) }));
// Imported by nothing here on purpose — the assertion is that it is NEVER reached.
vi.mock('./plan-commit-flow.ts', () => ({ confirmPendingPlan: (...a: unknown[]) => commitActivities(...a) }));

const { COACH_ACTION_TOOLS, coachActionDefinitions } = await import('./coach-actions.ts');
const propose = COACH_ACTION_TOOLS.propose_plan_change!;

/**
 * The safety property this whole design rests on: an action tool PROPOSES. There is no path from
 * a model deciding something to a person's committed plan changing — the tap is the only door.
 */
describe('propose_plan_change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActivePlan.mockResolvedValue({ plan_id: 'p1', version: 2 });
    listGoalsByStatus.mockResolvedValue([{ goal_id: 'g1', title: 'Run a 10k' }]);
    listActivities.mockResolvedValue([
      {
        activity_id: 'a1',
        plan_id: 'p1',
        title: 'Easy run',
        kind: 'user',
        schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TH', duration_min: 40 },
        completion_source: 'self_report',
        goal_id: 'g1',
      },
    ]);
  });

  it('writes a PROPOSAL and never commits', async () => {
    const out = await propose.run('u1', { edits: [{ action: 'move', activity: 'Easy run', days: ['friday'] }] });

    expect(setPendingPlan).toHaveBeenCalledTimes(1);
    expect(commitActivities).not.toHaveBeenCalled();
    const [, pending] = setPendingPlan.mock.calls[0]!;
    expect(pending.activities[0].recurrence).toBe('FREQ=WEEKLY;BYDAY=FR');
    expect(pending.rationale).toContain('Move Easy run');
    // The model is told, in the tool's own output, not to claim it is done.
    expect(out).toMatch(/Apply button/);
    expect(out).toMatch(/Do NOT claim it is done/);
  });

  it('tells the coach to offer a build instead when there is no plan to change', async () => {
    getActivePlan.mockResolvedValue(null);
    const out = await propose.run('u1', { edits: [{ action: 'remove', activity: 'Easy run' }] });
    expect(setPendingPlan).not.toHaveBeenCalled();
    expect(out).toMatch(/no active plan/i);
  });

  it('proposes nothing when it could not match what was named', async () => {
    const out = await propose.run('u1', { edits: [{ action: 'move', activity: 'Pilates', days: ['monday'] }] });
    expect(setPendingPlan).not.toHaveBeenCalled();
    expect(out).toMatch(/Nothing could be changed/);
    expect(out).toMatch(/Pilates/);
  });

  it('refuses to propose an empty week', async () => {
    const out = await propose.run('u1', { edits: [{ action: 'remove', activity: 'Easy run' }] });
    expect(setPendingPlan).not.toHaveBeenCalled();
    expect(out).toMatch(/empty their plan/);
  });

  it('ignores junk edits rather than acting on half of them', async () => {
    const out = await propose.run('u1', { edits: [{ action: 'explode', activity: 'Easy run' }] });
    expect(setPendingPlan).not.toHaveBeenCalled();
    expect(out).toMatch(/No usable changes/);
  });

  it('declares a schema the model can actually fill in', () => {
    const def = coachActionDefinitions().find((d) => d.function.name === 'propose_plan_change')!;
    expect((def.function.parameters as { required?: string[] }).required).toEqual(['edits']);
    const d = def.function.description;
    // The tiebreak against the rebuild card, and the honesty about what calling it does.
    expect(d).toMatch(/does NOT change anything/i);
    expect(d).toMatch(/build card/);
    expect(d).toMatch(/get_active_plan/);
  });
});
