import { beforeEach, describe, expect, it, vi } from 'vitest';

const getActivePlan = vi.fn();
const listActivities = vi.fn();
const listGoalsByStatus = vi.fn();
const setPendingPlan = vi.fn();
const commitActivities = vi.fn();
const listGoals = vi.fn();
const updateGoal = vi.fn();
const setGoalStatus = vi.fn();
const insertGoalEvent = vi.fn();
const listLoggedForCorrection = vi.fn();
const correctOccurrenceLog = vi.fn();

vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/activities.ts', () => ({ listActivities: (...a: unknown[]) => listActivities(...a) }));
vi.mock('../repos/goals.ts', () => ({
  listGoalsByStatus: (...a: unknown[]) => listGoalsByStatus(...a),
  listGoals: (...a: unknown[]) => listGoals(...a),
  updateGoal: (...a: unknown[]) => updateGoal(...a),
  setGoalStatus: (...a: unknown[]) => setGoalStatus(...a),
}));
vi.mock('../repos/goal-events.ts', () => ({ insertGoalEvent: (...a: unknown[]) => insertGoalEvent(...a) }));
vi.mock('../repos/occurrences.ts', () => ({
  listLoggedForCorrection: (...a: unknown[]) => listLoggedForCorrection(...a),
  correctOccurrenceLog: (...a: unknown[]) => correctOccurrenceLog(...a),
}));
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

describe('update_goal', () => {
  const update = COACH_ACTION_TOOLS.update_goal!;
  beforeEach(() => {
    vi.clearAllMocks();
    insertGoalEvent.mockResolvedValue({});
    listGoals.mockResolvedValue([
      {
        goal_id: 'g1',
        title: 'Read 100 books',
        status: 'committed',
        measure: { metric: 'count', target: 100, unit: 'books' },
        timeframe: { end: '2026-12-31' },
      },
      { goal_id: 'g2', title: 'Run a 10k', status: 'committed', measure: {}, timeframe: {} },
      { goal_id: 'g3', title: 'Old thing', status: 'abandoned', measure: {}, timeframe: {} },
    ]);
  });

  it('retargets, keeping the unit, and leaves a trail on the goal', async () => {
    const out = await update.run('u1', { goal: 'Read 100 books', action: 'retarget', target: 50 });
    expect(updateGoal).toHaveBeenCalledWith('u1', 'g1', { measure: { metric: 'count', target: 50, unit: 'books' } });
    expect(insertGoalEvent.mock.calls[0]![1].label).toBe('Target changed: 100 → 50 books');
    expect(out).toMatch(/aims at 50 books/);
    // The plan does not follow automatically, and she must not imply it did.
    expect(out).toMatch(/offer to rebuild/);
  });

  it('moves a date, and refuses one it cannot read', async () => {
    await update.run('u1', { goal: 'Run a 10k', action: 'redate', date: '2026-11-01' });
    expect(updateGoal).toHaveBeenCalledWith('u1', 'g2', { timeframe: { end: '2026-11-01' } });

    vi.clearAllMocks();
    listGoals.mockResolvedValue([
      { goal_id: 'g2', title: 'Run a 10k', status: 'committed', measure: {}, timeframe: {} },
    ]);
    const out = await update.run('u1', { goal: 'Run a 10k', action: 'redate', date: 'next spring' });
    expect(updateGoal).not.toHaveBeenCalled();
    expect(out).toMatch(/No usable date/);
  });

  it('completes warmly and stops without blame', async () => {
    const done = await update.run('u1', { goal: 'Read 100 books', action: 'complete' });
    expect(setGoalStatus).toHaveBeenCalledWith('u1', 'g1', 'completed');
    expect(done).toMatch(/worth a sentence/);

    const stopped = await update.run('u1', { goal: 'Run a 10k', action: 'stop' });
    expect(setGoalStatus).toHaveBeenCalledWith('u1', 'g2', 'abandoned');
    expect(stopped).toMatch(/without any suggestion they failed/);
  });

  it('never touches a goal they already finished or dropped', async () => {
    const out = await update.run('u1', { goal: 'Old thing', action: 'complete' });
    expect(setGoalStatus).not.toHaveBeenCalled();
    expect(out).toMatch(/Nothing clearly matches/);
  });

  it('changes nothing when the target is missing', async () => {
    const out = await update.run('u1', { goal: 'Read 100 books', action: 'retarget' });
    expect(updateGoal).not.toHaveBeenCalled();
    expect(out).toMatch(/No new target/);
  });
});

describe('correct_log', () => {
  const correct = COACH_ACTION_TOOLS.correct_log!;
  beforeEach(() => {
    vi.clearAllMocks();
    listLoggedForCorrection.mockResolvedValue([
      {
        occurrence_id: 'o1',
        date: '2026-08-12',
        title: 'Easy run',
        status: 'done',
        value: { distance_km: 3 },
        log: { items: [], summary: '3 km', raw_text: 'ran 3k', logged_at: '2026-08-12T07:00:00Z' },
      },
      { occurrence_id: 'o2', date: '2026-08-10', title: 'Sit', status: 'done', value: {}, log: null },
    ]);
  });

  it('replaces the numbers and rewrites the summary to match', async () => {
    const out = await correct.run('u1', { activity: 'Easy run', date: '2026-08-12', metrics: { distance_km: 5 } });
    const [, id, fields] = correctOccurrenceLog.mock.calls[0]!;
    expect(id).toBe('o1');
    expect(fields.value).toEqual({ distance_km: 5 });
    expect(fields.log.summary).toBe('5 distance km');
    // The user's exact words are never overwritten by a correction.
    expect(fields.log.raw_text).toBe('ran 3k');
    expect(out).toMatch(/now reads/);
  });

  it('un-counts a session that never happened', async () => {
    const out = await correct.run('u1', { activity: 'Sit', not_done: true });
    expect(correctOccurrenceLog).toHaveBeenCalledWith('u1', 'o2', { status: 'skipped' });
    expect(out).toMatch(/never a failure/);
  });

  it('asks rather than guessing when the session is not found', async () => {
    const out = await correct.run('u1', { activity: 'Swimming', metrics: { distance_km: 1 } });
    expect(correctOccurrenceLog).not.toHaveBeenCalled();
    expect(out).toMatch(/Recent ones: 2026-08-12 Easy run/);
  });

  it('does nothing when given neither numbers nor a not-done flag', async () => {
    const out = await correct.run('u1', { activity: 'Easy run' });
    expect(correctOccurrenceLog).not.toHaveBeenCalled();
    expect(out).toMatch(/No corrected numbers/);
  });
});
