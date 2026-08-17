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
const deleteOccurrence = vi.fn();
const getUser = vi.fn();
const mergeCapturedConstraints = vi.fn();
const removeCapturedConstraint = vi.fn();
const renameCapturedConstraint = vi.fn();
const setMacroTargets = vi.fn();

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
  deleteOccurrence: (...a: unknown[]) => deleteOccurrence(...a),
}));
vi.mock('../repos/users.ts', () => ({
  setPendingPlan: (...a: unknown[]) => setPendingPlan(...a),
  getUser: (...a: unknown[]) => getUser(...a),
  mergeCapturedConstraints: (...a: unknown[]) => mergeCapturedConstraints(...a),
  removeCapturedConstraint: (...a: unknown[]) => removeCapturedConstraint(...a),
  renameCapturedConstraint: (...a: unknown[]) => renameCapturedConstraint(...a),
  setMacroTargets: (...a: unknown[]) => setMacroTargets(...a),
}));
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
        // The handle is the first 8 hex of THIS (0036), so tests address it as "aaaaaaaa".
        commitment_id: 'aaaaaaaa-1111-4111-8111-111111111111',
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

  /**
   * Since 0036 a handle names a COMMITMENT, which survives Apply — so a stale version is no
   * longer fatal to a handle-addressed edit. The TITLE fallback is the part that is still
   * dangerous on a moved plan: it resolves happily against the new one and carries out intent
   * formed against the old.
   */
  it('refuses a title-addressed edit when the plan moved after she read it', async () => {
    getActivePlan.mockResolvedValue({ plan_id: 'p1', version: 9 });
    const out = await propose.run('u1', {
      plan_version: 7,
      edits: [{ action: 'move', activity: 'Easy run', days: ['friday'] }],
    });
    expect(setPendingPlan).not.toHaveBeenCalled();
    expect(out).toMatch(/v9 now, not v7/);
    expect(out).toMatch(/NOTHING was changed/);
    expect(out).toMatch(/get_active_plan again/);
  });

  /** The friction A19 removes: a handle read three versions ago still names the right commitment,
   *  so a moved plan is a note in her ear, not a refusal and a re-read. */
  it('proceeds on a moved plan when the edit is addressed by handle, and says it moved', async () => {
    getActivePlan.mockResolvedValue({ plan_id: 'p1', version: 9 });
    const out = await propose.run('u1', {
      plan_version: 7,
      edits: [{ action: 'move', activities: ['aaaaaaaa'], days: ['friday'] }],
    });
    expect(setPendingPlan).toHaveBeenCalledTimes(1);
    expect(out).toMatch(/Apply button/);
    expect(out).toMatch(/v9 now, not v7 — this was applied to the current one/);
  });

  it('proceeds when the version she read is still the live one', async () => {
    const out = await propose.run('u1', {
      plan_version: 2,
      edits: [{ action: 'move', activity: 'Easy run', days: ['friday'] }],
    });
    expect(setPendingPlan).toHaveBeenCalledTimes(1);
    expect(out).toMatch(/Apply button/);
  });

  /**
   * The empty card. 2026-08-17: she resized two runs to the length they already were, the tool
   * called that two changes, and the owner tapped Apply on a proposal whose entire content was
   * "Easy run: 40 min → 40 min" twice. Plan v10 committed identical to v9 across all sixteen
   * activities and regenerated ten prescribed sessions to change nothing.
   */
  it('raises NO card when every edit asks for what the plan already says', async () => {
    const out = await propose.run('u1', {
      edits: [{ action: 'resize', activities: ['aaaaaaaa'], duration_min: 40 }],
    });
    expect(setPendingPlan).not.toHaveBeenCalled();
    expect(out).toMatch(/already says all of this/);
    expect(out).toMatch(/already 40 min/);
    expect(out).toMatch(/Do NOT put up a card/);
  });

  it('still proposes the real half of a batch, and keeps the redundant half off the card', async () => {
    listActivities.mockResolvedValue([
      {
        activity_id: 'a1',
        commitment_id: 'aaaaaaaa-1111-4111-8111-111111111111',
        plan_id: 'p1',
        title: 'Easy run',
        kind: 'user',
        schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TH', duration_min: 40 },
        completion_source: 'self_report',
        goal_id: 'g1',
      },
      {
        activity_id: 'a2',
        commitment_id: 'bbbbbbbb-1111-4111-8111-111111111111',
        plan_id: 'p1',
        title: 'Long run',
        kind: 'user',
        schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=SA', duration_min: 90 },
        completion_source: 'self_report',
        goal_id: 'g1',
      },
    ]);
    const out = await propose.run('u1', {
      edits: [
        { action: 'resize', activities: ['aaaaaaaa'], duration_min: 40 },
        { action: 'resize', activities: ['bbbbbbbb'], duration_min: 75 },
      ],
    });
    expect(setPendingPlan).toHaveBeenCalledTimes(1);
    const [, pending] = setPendingPlan.mock.calls[0]!;
    // The card carries only what actually differs.
    expect(pending.rationale).toBe('Long run: 90 min → 75 min');
    expect(out).toMatch(/Already the case, so not on the card:/);
    expect(out).toMatch(/Easy run is already 40 min/);
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
        recurrence: 'FREQ=WEEKLY;BYDAY=WE',
        log: { items: [], summary: '3 km', raw_text: 'ran 3k', logged_at: '2026-08-12T07:00:00Z' },
      },
      // The off-plan bucket: empty recurrence, so this row exists only because it was logged.
      { occurrence_id: 'o2', date: '2026-08-10', title: 'Sit', status: 'done', value: {}, log: null, recurrence: '' },
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

  it('un-counts a SCHEDULED session that did not happen, keeping the slot', async () => {
    const out = await correct.run('u1', { activity: 'Easy run', not_done: true });
    expect(correctOccurrenceLog).toHaveBeenCalledWith('u1', 'o1', { status: 'skipped' });
    expect(deleteOccurrence).not.toHaveBeenCalled();
    expect(out).toMatch(/never a failure/);
  });

  /**
   * The owner's own example: "I think you logged that run on Sunday by accident — I didn't
   * actually run Sunday." Nothing was scheduled, so the row only exists because it was logged.
   * Marking it skipped would invent a missed session and count it against their consistency,
   * which is punishing someone for correcting our mistake.
   */
  it('erases a session that was never scheduled and never happened', async () => {
    const out = await correct.run('u1', { activity: 'Sit', not_done: true });
    expect(deleteOccurrence).toHaveBeenCalledWith('u1', 'o2');
    expect(correctOccurrenceLog).not.toHaveBeenCalled();
    expect(out).toMatch(/gone entirely/);
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

/**
 * The owner's distinction, and the reason this tool has four verbs instead of two:
 * "an injury can be latent or recovered from, and this is different from 'you captured that
 * injury wrong, I don't have a knee injury and I never did'." Recovery is history and is kept.
 * A mis-capture is an error and is erased. Only the second deletes anything.
 */
describe('update_constraint', () => {
  const constraint = COACH_ACTION_TOOLS.update_constraint!;
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({
      baseline: {
        constraints: [
          { id: 'c1', label: 'left knee — patellar tendinopathy', kind: 'physical', plan_around: true },
          { id: 'c2', label: 'night shifts', kind: 'life', plan_around: true },
        ],
      },
    });
    removeCapturedConstraint.mockResolvedValue(true);
    renameCapturedConstraint.mockResolvedValue(null);
  });

  /**
   * The tool re-READS after writing and reports what it can see, so a test has to model the read
   * as well as the write — mocking a fixed `getUser` is mocking a database that ignores writes.
   * That is the point of the change: on 2026-08-16 the coach said a constraint was removed and it
   * was still there, so "it worked" is now something the tool observes rather than assumes.
   */
  const afterWrite = (constraints: Array<Record<string, unknown>>) => {
    getUser.mockResolvedValueOnce({
      baseline: {
        constraints: [
          { id: 'c1', label: 'left knee — patellar tendinopathy', kind: 'physical', plan_around: true },
          { id: 'c2', label: 'night shifts', kind: 'life', plan_around: true },
        ],
      },
    });
    getUser.mockResolvedValue({ baseline: { constraints } });
  };

  it('LIFTS a recovered injury without forgetting it', async () => {
    afterWrite([
      { id: 'c1', label: 'left knee — patellar tendinopathy', plan_around: false, status: 'quiet' },
      { id: 'c2', label: 'night shifts', plan_around: true },
    ]);
    const out = await constraint.run('u1', { constraint: 'left knee', action: 'lift' });
    expect(removeCapturedConstraint).not.toHaveBeenCalled();
    const [, written] = mergeCapturedConstraints.mock.calls[0]!;
    expect(written[0].status).toBe('quiet');
    expect(written[0].plan_around).toBe(false);
    // Matched against what is on file, so the fuller stored label survives.
    expect(written[0].label).toBe('left knee — patellar tendinopathy');
    expect(out).toMatch(/still on file/);
  });

  it('brings one back when it flares', async () => {
    await constraint.run('u1', { constraint: 'left knee', action: 'flare' });
    const [, written] = mergeCapturedConstraints.mock.calls[0]!;
    expect(written[0].status).toBe('active');
    expect(written[0].plan_around).toBe(true);
    expect(removeCapturedConstraint).not.toHaveBeenCalled();
  });

  it('DELETES only what was never true', async () => {
    // `remove` reads exactly once — the verify — so this is the post-write state, nothing queued.
    getUser.mockResolvedValue({ baseline: { constraints: [{ id: 'c2', label: 'night shifts', plan_around: true }] } });
    const out = await constraint.run('u1', { constraint: 'left knee', action: 'remove' });
    expect(removeCapturedConstraint).toHaveBeenCalledWith('u1', 'left knee');
    expect(mergeCapturedConstraints).not.toHaveBeenCalled();
    expect(out).toMatch(/verified gone/);
  });

  it('says so plainly when there was nothing to remove', async () => {
    removeCapturedConstraint.mockResolvedValue(false);
    const out = await constraint.run('u1', { constraint: 'a bad back', action: 'remove' });
    expect(out).toMatch(/Nothing on file matches/);
  });

  it('adds a new one, defaulting to planning around it', async () => {
    afterWrite([
      { id: 'c1', label: 'left knee — patellar tendinopathy', plan_around: true },
      { id: 'c3', label: 'wrist pain', plan_around: true },
    ]);
    const out = await constraint.run('u1', { constraint: 'wrist pain', action: 'add', kind: 'physical' });
    const [, written] = mergeCapturedConstraints.mock.calls[0]!;
    expect(written[0].label).toBe('wrist pain');
    expect(written[0].plan_around).toBe(true);
    expect(written[0].kind).toBe('physical');
    expect(out).toMatch(/so they can correct you/);
  });

  /**
   * The exact failure of 2026-08-16, inverted into a guard: the write does not land, and the tool
   * must say so rather than let her tell the user it is done.
   */
  it('refuses to report success when the removal did not actually take', async () => {
    // The read after the write still shows it — a silent no-op, which is what really happened.
    const out = await constraint.run('u1', { constraint: 'left knee', action: 'remove' });
    expect(out).toMatch(/STILL on their file/);
    expect(out).toMatch(/Do NOT tell them it is gone/);
    expect(out).toMatch(/Settings/);
  });

  it('refuses to report an ease that did not save', async () => {
    // plan_around stays true after the write — the change did not take.
    const out = await constraint.run('u1', { constraint: 'left knee', action: 'lift' });
    expect(out).toMatch(/still being planned around/);
    expect(out).toMatch(/Do NOT say it is eased/);
  });

  it('will not lift something it cannot find, and lists what it has', async () => {
    const out = await constraint.run('u1', { constraint: 'shoulder', action: 'lift' });
    expect(mergeCapturedConstraints).not.toHaveBeenCalled();
    expect(out).toMatch(/night shifts/);
  });

  /**
   * The promise we kept missing.
   *
   * The Broker recorded "ramp gently because of tendinitis" — an instruction where a fact belongs,
   * and it shaped every plan that read it. Asked several times to fix the wording, Cadence agreed
   * several times and nothing changed: there was no reword action, so she reached for a plan change
   * on an activity instead. Owner: *"we miss the promise on 'fix the wording'."*
   *
   * It cannot go through the merge path either — `mergeConstraints` keeps the LONGER telling, so a
   * shortening is discarded in silence, and shortening is exactly what a correction usually is.
   */
  it('REWORDS a badly-worded constraint, shorter, without touching its history', async () => {
    renameCapturedConstraint.mockResolvedValue({
      from: 'ramp gently because of tendinitis',
      to: 'left ankle tendinitis',
    });
    getUser.mockResolvedValue({
      baseline: { constraints: [{ id: 'c1', label: 'left ankle tendinitis', plan_around: true, status: 'active' }] },
    });

    const out = await constraint.run('u1', {
      constraint: 'ramp gently because of tendinitis',
      action: 'reword',
      new_label: 'left ankle tendinitis',
    });

    expect(renameCapturedConstraint).toHaveBeenCalledWith(
      'u1',
      'ramp gently because of tendinitis',
      'left ankle tendinitis',
    );
    // Not a merge and not a delete — the row is the same row.
    expect(mergeCapturedConstraints).not.toHaveBeenCalled();
    expect(removeCapturedConstraint).not.toHaveBeenCalled();
    expect(out).toMatch(/now reads "left ankle tendinitis"/);
    expect(out).toMatch(/verified/);
  });

  it('will not reword without new wording, and asks for it', async () => {
    const out = await constraint.run('u1', { constraint: 'left knee', action: 'reword' });
    expect(renameCapturedConstraint).not.toHaveBeenCalled();
    expect(out).toMatch(/No new wording/);
  });

  it('refuses to report a reword that did not take', async () => {
    renameCapturedConstraint.mockResolvedValue({ from: 'left knee', to: 'left knee tendinopathy' });
    // The read after the write still shows the old wording — a silent no-op.
    getUser.mockResolvedValue({ baseline: { constraints: [{ id: 'c1', label: 'left knee', plan_around: true }] } });
    const out = await constraint.run('u1', {
      constraint: 'left knee',
      action: 'reword',
      new_label: 'left knee tendinopathy',
    });
    expect(out).toMatch(/did NOT get reworded/);
    expect(out).toMatch(/Settings/);
  });

  it('says plainly when there is nothing by that name to reword', async () => {
    renameCapturedConstraint.mockResolvedValue(null);
    const out = await constraint.run('u1', { constraint: 'a bad back', action: 'reword', new_label: 'lower back' });
    expect(out).toMatch(/Nothing on file matches/);
  });

  it('carries an end date when they gave one', async () => {
    await constraint.run('u1', { constraint: 'away in Lisbon', action: 'add', until: '2026-09-30' });
    const [, written] = mergeCapturedConstraints.mock.calls[0]!;
    expect(written[0].until).toBe('2026-09-30');
  });
});

/**
 * The loop the owner called "the whole point of the coaching": if they follow the targets and the
 * scale does not move — or moves too fast to be healthy — the coach changes the numbers. The
 * engine for deciding that already existed; until now she had no way to act on it.
 */
describe('set_macro_targets', () => {
  const setTargets = COACH_ACTION_TOOLS.set_macro_targets!;
  beforeEach(() => {
    vi.clearAllMocks();
    insertGoalEvent.mockResolvedValue({});
    getUser.mockResolvedValue({ macro_targets: { kcal: 1900, protein_g: 150, eatback_pct: 50 } });
  });

  it('adjusts the numbers and keeps settings that are not targets', async () => {
    const out = await setTargets.run('u1', { kcal: 2100, why: 'losing faster than is safe — adding 200 back' });
    const [, written] = setMacroTargets.mock.calls[0]!;
    expect(written.kcal).toBe(2100);
    expect(written.protein_g).toBe(150); // untouched, not wiped
    expect(written.eatback_pct).toBe(50); // a setting, not a target — must survive
    expect(written.last_reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out).toMatch(/was 1900 kcal/);
  });

  it('leaves a trail naming the change and the reason', async () => {
    await setTargets.run('u1', { kcal: 2100, why: 'losing faster than is safe' });
    expect(insertGoalEvent.mock.calls[0]![1].label).toMatch(/1900 → 2100 kcal: losing faster/);
  });

  it('refuses a target with no reason — one nobody can explain will not be kept', async () => {
    const out = await setTargets.run('u1', { kcal: 2100 });
    expect(setMacroTargets).not.toHaveBeenCalled();
    expect(out).toMatch(/No reason was given/);
  });

  it('refuses numbers that do not survive the safety check', async () => {
    const out = await setTargets.run('u1', { kcal: 600, why: 'they asked for it' });
    expect(setMacroTargets).not.toHaveBeenCalled();
    expect(out).toMatch(/did not survive the safety check/);
  });

  it('sets a first target when there were none', async () => {
    getUser.mockResolvedValue({ macro_targets: null });
    const out = await setTargets.run('u1', { kcal: 2200, protein_g: 160, why: 'a starting point we can adjust' });
    expect(setMacroTargets.mock.calls[0]![1]).toMatchObject({ kcal: 2200, protein_g: 160 });
    expect(out).not.toMatch(/was /);
  });

  it('tells her to speak the change as a decision, not a settings update', async () => {
    const out = await setTargets.run('u1', { kcal: 2100, why: 'x' });
    expect(out).toMatch(/sound like a decision you made/);
  });
});
