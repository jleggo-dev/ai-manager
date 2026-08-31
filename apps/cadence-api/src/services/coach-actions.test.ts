import { beforeEach, describe, expect, it, vi } from 'vitest';

const getActivePlan = vi.fn();
const listActivities = vi.fn();
const listGoalsByStatus = vi.fn();
const setPendingPlan = vi.fn();
const commitActivities = vi.fn();
const listGoals = vi.fn();
const updateGoal = vi.fn();
const setGoalStatus = vi.fn();
const retireGoal = vi.fn();
const restoreGoal = vi.fn();
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
  retireGoal: (...a: unknown[]) => retireGoal(...a),
  restoreGoal: (...a: unknown[]) => restoreGoal(...a),
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
    // The card carries only what actually differs — and says WHICH commitment, since two can
    // share a title. This fixture has no time, so the line says so rather than staying quiet.
    expect(pending.rationale).toBe('Long run (Sat, no time set): 90 min → 75 min');
    expect(out).toMatch(/Already the case, so not on the card:/);
    expect(out).toMatch(/Easy run \(Thu, no time set\) is already 40 min/);
  });

  it('declares a schema the model can actually fill in', () => {
    const def = coachActionDefinitions().find((d) => d.function.name === 'propose_plan_change')!;
    expect((def.function.parameters as { required?: string[] }).required).toEqual(['edits']);
    const d = def.function.description;
    // The tiebreak against the rebuild card, and the honesty about what calling it does.
    expect(d).toMatch(/does NOT change anything/i);
    expect(d).toMatch(/build card/);
    expect(d).toMatch(/get_active_plan/);
    // Owner 2026-08-31 (the coach IS the planner): a whole week is one call carrying the slate,
    // and the return is where she checks the shape before telling the user it is up.
    expect(d).toMatch(/ONE call carrying the full slate/);
    expect(d).toMatch(/reports the proposed week's shape/);
  });

  /**
   * The evidence report (owner ruling 2026-08-31: guards return evidence, she adjudicates). The
   * scar: the owner's proposed week stacked hill intervals + an early run on a Wednesday whose own
   * constraint said ONE workout, no afternoons — and the return, being only diff lines, could not
   * show her the week she had just proposed.
   */
  it('returns the proposed week as evidence — shape, collisions, and the constraint check-list', async () => {
    listActivities.mockResolvedValue([
      {
        activity_id: 'a1',
        commitment_id: 'aaaaaaaa-1111-4111-8111-111111111111',
        plan_id: 'p1',
        title: 'Easy run',
        kind: 'user',
        schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TH', duration_min: 40, time_of_day: '07:00' },
        completion_source: 'self_report',
        goal_id: 'g1',
      },
      {
        activity_id: 'a2',
        commitment_id: 'bbbbbbbb-1111-4111-8111-111111111111',
        plan_id: 'p1',
        title: 'Hill intervals',
        kind: 'user',
        schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=WE', duration_min: 30, time_of_day: '07:00' },
        completion_source: 'self_report',
        goal_id: 'g1',
      },
    ]);
    getUser.mockResolvedValue({
      pending_plan: null,
      baseline: {
        constraints: [
          { id: 'c1', label: 'Wednesdays: one workout, no afternoons', plan_around: true },
          // Eased — the plan no longer bends for it, so the check-list must not carry it.
          { id: 'c2', label: 'left knee — patellar tendinopathy', plan_around: false },
        ],
      },
    });

    const out = await propose.run('u1', {
      edits: [{ action: 'move', activities: ['aaaaaaaa'], days: ['wednesday'] }],
    });

    expect(out).toMatch(
      /Proposed week shape \(their own items per day\): Mo — · Tu — · We 2 · Th — · Fr — · Sa — · Su —/,
    );
    expect(out).toMatch(/Time collision: "Easy run" and "Hill intervals" both land on Wed at 07:00\./);
    expect(out).toMatch(/work around: Wednesdays: one workout, no afternoons — check the proposed week against these/);
    expect(out).not.toMatch(/left knee/);
    // Evidence, never a blocker: the card still went up for the user to judge too.
    expect(setPendingPlan).toHaveBeenCalledTimes(1);
    expect(out).toMatch(/Apply button/);
  });

  /**
   * Owner ruling 2026-08-17: "If I'm going to do a 40 min run the run should be 40mins, regardless
   * of if I have to warm-up before or stretch after."
   *
   * The description told the model the opposite for a while — "minutes for the WHOLE session door
   * to door… A 40-minute RUN is roughly 50 here" — so asking for a 40 minute run wrote 50 into the
   * plan and prescribe-session then carved a warm-up back out of it. This is the only place the
   * coach is told what the number means, so it is worth pinning.
   */
  it('tells the coach duration_min is the effort the person named, not the padded session', () => {
    const def = coachActionDefinitions().find((d) => d.function.name === 'propose_plan_change')!;
    const props = (
      def.function.parameters as {
        properties: { edits: { items: { properties: Record<string, { description: string }> } } };
      }
    ).properties.edits.items.properties;

    const dur = props.duration_min!.description;
    expect(dur).toMatch(/ACTIVITY ITSELF/);
    expect(dur).toMatch(/40 minute run" is 40/);
    expect(dur).toMatch(/20 minute meditation" is 20/);
    expect(dur).toMatch(/do NOT pad it/i);
    // The reverted instruction, in every form it took.
    expect(dur).not.toMatch(/WHOLE session/i);
    expect(dur).not.toMatch(/door to door/i);
    expect(dur).not.toMatch(/roughly 50/);

    // ...and how_to must no longer claim the running TIME belongs to it instead.
    expect(props.how_to!.description).not.toMatch(/running time HERE/i);
    expect(props.how_to!.description).toMatch(/duration_min/);
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
      { goal_id: 'g4', title: 'Obstacle race', status: 'parked', measure: {}, timeframe: {} },
    ]);
  });

  it('retargets, keeping the unit, and leaves a trail on the goal', async () => {
    const out = await update.run('u1', { goal: 'Read 100 books', action: 'retarget', target: 50 });
    expect(updateGoal).toHaveBeenCalledWith('u1', 'g1', {
      measure: { metric: 'count', target: 50, unit: 'books' },
      // The TITLE moves too — see below.
      title: 'Read 50 books',
    });
    expect(insertGoalEvent.mock.calls[0]![1].label).toBe('Target changed: 100 → 50 books');
    expect(out).toMatch(/aims at 50 books/);
    // The plan does not follow automatically, and she must not imply it did.
    expect(out).toMatch(/offer to rebuild/);
  });

  /**
   * The title is what every list, card and prompt shows, and retarget used to leave it saying the
   * old number — "Read 100 books this year" aiming at 50. Caught by the outcome eval's JUDGE on
   * 2026-08-22 while its deterministic assert passed, because that assert only checked the field
   * the tool had just written. Both now check it.
   */
  it('carries the number in the title, and says the new title back', async () => {
    const out = await update.run('u1', { goal: 'Read 100 books', action: 'retarget', target: 50 });
    expect(out).toMatch(/"Read 50 books"/);
  });

  /** A title whose number is ambiguous is left as the user wrote it — see goal-retitle.test.ts. */
  it('leaves a title alone when it carries no number of its own', async () => {
    listGoals.mockResolvedValue([
      {
        goal_id: 'g9',
        title: 'Read more books',
        status: 'committed',
        measure: { target: 100, unit: 'books' },
        timeframe: {},
      },
    ]);
    await update.run('u1', { goal: 'Read more books', action: 'retarget', target: 50 });
    expect(updateGoal).toHaveBeenCalledWith('u1', 'g9', { measure: { target: 50, unit: 'books' } });
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

  it('retires a goal and leaves a trail — it stops shaping the plan, Progress keeps it', async () => {
    retireGoal.mockResolvedValue({ goal_id: 'g1', status: 'parked' });
    const out = await update.run('u1', { goal: 'Read 100 books', action: 'retire' });
    expect(retireGoal).toHaveBeenCalledWith('u1', 'g1');
    expect(insertGoalEvent.mock.calls[0]![1].label).toBe('Set aside: Read 100 books');
    expect(out).toMatch(/set aside/i);
    expect(out).toMatch(/stays in Progress/);
    expect(out).toMatch(/without any suggestion they failed/);
  });

  it('restores a parked goal — matched even though get_objectives would not list it', async () => {
    restoreGoal.mockResolvedValue({ goal_id: 'g4', status: 'committed' });
    const out = await update.run('u1', { goal: 'Obstacle race', action: 'restore' });
    expect(restoreGoal).toHaveBeenCalledWith('u1', 'g4');
    expect(insertGoalEvent.mock.calls[0]![1].label).toBe('Brought back: Obstacle race');
    expect(out).toMatch(/is back/);
  });

  it('refuses to retire a goal that is already set aside', async () => {
    const out = await update.run('u1', { goal: 'Obstacle race', action: 'retire' });
    expect(retireGoal).not.toHaveBeenCalled();
    expect(out).toMatch(/already set aside/);
  });

  it('refuses to restore a goal that was never set aside', async () => {
    const out = await update.run('u1', { goal: 'Run a 10k', action: 'restore' });
    expect(restoreGoal).not.toHaveBeenCalled();
    expect(out).toMatch(/not set aside/);
  });

  it('says so plainly, without touching the goal, when the repo finds nothing to update', async () => {
    retireGoal.mockResolvedValue(null);
    const out = await update.run('u1', { goal: 'Read 100 books', action: 'retire' });
    expect(insertGoalEvent).not.toHaveBeenCalled();
    expect(out).toMatch(/Could not retire/);
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

  it('corrects the named numbers and rewrites the summary to match', async () => {
    const out = await correct.run('u1', { activity: 'Easy run', date: '2026-08-12', metrics: { distance_km: 5 } });
    const [, id, fields] = correctOccurrenceLog.mock.calls[0]!;
    expect(id).toBe('o1');
    expect(fields.value).toEqual({ distance_km: 5 });
    expect(fields.log.summary).toBe('5 distance km');
    // The user's exact words are never overwritten by a correction.
    expect(fields.log.raw_text).toBe('ran 3k');
    expect(out).toMatch(/now reads/);
  });

  /**
   * The eval finding (correct-logged-distance): the coach corrected a run's distance to 8 km and
   * the stored log LOST its duration, because the correction's metrics replaced the whole value
   * column. A correction NAMES fields; the fields it does not name survive — constraint-merge
   * rule 1, nothing is dropped by silence. And what the tool reports back is the whole record as
   * it now stands, not just the fields that moved.
   */
  it('keeps the metrics the correction did not name', async () => {
    listLoggedForCorrection.mockResolvedValue([
      {
        occurrence_id: 'o3',
        date: '2026-08-14',
        title: 'Long run',
        status: 'done',
        value: { distance_km: 5, duration_min: 28, avg_hr: 152 },
        recurrence: 'FREQ=WEEKLY;BYDAY=FR',
        log: { items: [], summary: '5 km in 28 min', raw_text: 'ran 5k in 28', logged_at: '2026-08-14T07:00:00Z' },
      },
    ]);
    const out = await correct.run('u1', { activity: 'Long run', metrics: { distance_km: 8 } });
    const [, id, fields] = correctOccurrenceLog.mock.calls[0]!;
    expect(id).toBe('o3');
    expect(fields.value).toEqual({ distance_km: 8, duration_min: 28, avg_hr: 152 });
    // The stored summary and the reply both say what the record NOW says — all of it.
    expect(fields.log.summary).toContain('8 distance km');
    expect(fields.log.summary).toContain('28 duration min');
    expect(out).toContain('28 duration min');
  });

  it('still writes only the named fields when the record had no stored numbers', async () => {
    listLoggedForCorrection.mockResolvedValue([
      { occurrence_id: 'o4', date: '2026-08-13', title: 'Sit', status: 'done', value: null, log: null, recurrence: '' },
    ]);
    await correct.run('u1', { activity: 'Sit', metrics: { duration_min: 10 } });
    const [, id, fields] = correctOccurrenceLog.mock.calls[0]!;
    expect(id).toBe('o4');
    expect(fields.value).toEqual({ duration_min: 10 });
    // No log existed, so none is invented — the value column carries the correction alone.
    expect(fields.log).toBeUndefined();
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

/**
 * The card that ate the other card.
 *
 * 2026-08-17, one turn apart: she proposed moving Box breathing to Sunday — a real card, correctly
 * computed — and then proposed two resizes. The second call recomputed from the COMMITTED plan and
 * `setPendingPlan` overwrote the first wholesale, so the owner got a card with only the runs and
 * reported that she had said she would move the breathing and hadn't. She had; the next call
 * deleted it. Nothing anywhere recorded the loss.
 */
describe('propose_plan_change — a second proposal builds on the first', () => {
  const TUE = 'aaaaaaaa-1111-4111-8111-111111111111';
  const SIT = 'bbbbbbbb-1111-4111-8111-111111111111';

  beforeEach(() => {
    vi.clearAllMocks();
    getActivePlan.mockResolvedValue({ plan_id: 'p1', version: 2 });
    listGoalsByStatus.mockResolvedValue([{ goal_id: 'g1', title: 'Run a 10k' }]);
    listActivities.mockResolvedValue([
      {
        activity_id: 'a1',
        commitment_id: TUE,
        plan_id: 'p1',
        title: 'Easy run',
        kind: 'user',
        schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU', duration_min: 40, time_of_day: '07:00' },
        completion_source: 'self_report',
        goal_id: 'g1',
      },
      {
        activity_id: 'a2',
        commitment_id: SIT,
        plan_id: 'p1',
        title: 'Box breathing practice',
        kind: 'user',
        schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO,FR', duration_min: 10, time_of_day: '20:00' },
        completion_source: 'self_report',
      },
    ]);
    getUser.mockResolvedValue({ pending_plan: null });
  });

  it('keeps the earlier change when a second call lands, and says both are on one card', async () => {
    // Call one: move the breathing. This is the card the owner was promised.
    await propose.run('u1', { edits: [{ action: 'move', activities: ['bbbbbbbb'], days: ['sunday'] }] });
    const [, first] = setPendingPlan.mock.calls[0]!;
    expect(first.rationale).toMatch(/Move Box breathing practice/);

    // The card is now live — exactly what the second call used to destroy.
    getUser.mockResolvedValue({ pending_plan: first });

    const out = await propose.run('u1', { edits: [{ action: 'resize', activities: ['aaaaaaaa'], duration_min: 45 }] });
    const [, second] = setPendingPlan.mock.calls[1]!;

    expect(second.rationale).toMatch(/Move Box breathing practice/); // survived
    expect(second.rationale).toMatch(/45 min/); // and the new one landed
    expect(out).toMatch(/Added to the card already up/);

    // The breathing move is still IN the activities, not just in the prose.
    const sit = second.activities.find((a: { title: string }) => a.title === 'Box breathing practice');
    expect(sit.recurrence).toBe('FREQ=WEEKLY;BYDAY=SU');
  });

  it('does not re-announce a standing card as new work when the second call achieves nothing', async () => {
    await propose.run('u1', { edits: [{ action: 'move', activities: ['bbbbbbbb'], days: ['sunday'] }] });
    const [, first] = setPendingPlan.mock.calls[0]!;
    getUser.mockResolvedValue({ pending_plan: first });
    setPendingPlan.mockClear();

    // Already 40 min — a no-op against the standing proposal.
    const out = await propose.run('u1', { edits: [{ action: 'resize', activities: ['aaaaaaaa'], duration_min: 40 }] });
    expect(setPendingPlan).not.toHaveBeenCalled();
    expect(out).toMatch(/already says all of this/);
    expect(out).toMatch(/card already up is unchanged/);
  });
});

/**
 * An action this build cannot perform is REPORTED. `rename` was filtered out silently, twice in
 * one call, while the coach told the owner she was renaming two commitments.
 */
describe('propose_plan_change — an action it has never heard of', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActivePlan.mockResolvedValue({ plan_id: 'p1', version: 2 });
    listGoalsByStatus.mockResolvedValue([{ goal_id: 'g1', title: 'Run a 10k' }]);
    listActivities.mockResolvedValue([
      {
        activity_id: 'a1',
        commitment_id: 'aaaaaaaa-1111-4111-8111-111111111111',
        plan_id: 'p1',
        title: 'Easy run',
        kind: 'user',
        schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU', duration_min: 40, time_of_day: '07:00' },
        completion_source: 'self_report',
        goal_id: 'g1',
      },
    ]);
    getUser.mockResolvedValue({ pending_plan: null });
  });

  it('names an unknown action instead of dropping it in silence', async () => {
    const out = await propose.run('u1', { edits: [{ action: 'explode', activities: ['aaaaaaaa'] }] });
    expect(setPendingPlan).not.toHaveBeenCalled();
    expect(out).toMatch(/no "explode" action/);
    expect(out).toMatch(/Do NOT tell them those parts happened/);
  });

  it('still reports the unknown half when the rest of the call succeeds', async () => {
    const out = await propose.run('u1', {
      edits: [
        { action: 'resize', activities: ['aaaaaaaa'], duration_min: 45 },
        { action: 'teleport', activities: ['aaaaaaaa'] },
      ],
    });
    expect(setPendingPlan).toHaveBeenCalledTimes(1);
    expect(out).toMatch(/Apply button/);
    expect(out).toMatch(/no "teleport" action/);
  });

  /** `rename` is the obvious word for a rework-with-a-title, so it is aliased rather than refused. */
  it('understands rename as a rework', async () => {
    const out = await propose.run('u1', {
      edits: [{ action: 'rename', activities: ['aaaaaaaa'], title: 'Tuesday shakeout' }],
    });
    expect(out).not.toMatch(/no "rename" action/);
    const [, pending] = setPendingPlan.mock.calls[0]!;
    expect(pending.activities.find((a: { title: string }) => a.title === 'Tuesday shakeout')).toBeTruthy();
  });
});

/**
 * The inverse of the card that ate the other card: the card that could not be UN-eaten.
 *
 * Accumulation fixed "second call destroys the first" and created this, live on 2026-08-18: asked
 * for Wednesday-only stretching the coach added "Stretching — Mon, Wed, Fri", noticed, said "let
 * me redo it properly" — and the redo added BESIDE the mistake, so the card ended holding both
 * adds and no call could make it hold less. `start_over` is the third door: drop the standing
 * card first, then compute ONLY this call's edits against the committed plan.
 */
describe('propose_plan_change — start_over redoes the card instead of adding beside it', () => {
  const WRONG_ADD = { action: 'add', title: 'Stretching', days: ['mon', 'wed', 'fri'], time_of_day: '07:00' };

  beforeEach(() => {
    vi.clearAllMocks();
    getActivePlan.mockResolvedValue({ plan_id: 'p1', version: 2 });
    listGoalsByStatus.mockResolvedValue([{ goal_id: 'g1', title: 'Run a 10k' }]);
    listActivities.mockResolvedValue([
      {
        activity_id: 'a1',
        commitment_id: 'aaaaaaaa-1111-4111-8111-111111111111',
        plan_id: 'p1',
        title: 'Easy run',
        kind: 'user',
        schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU', duration_min: 40, time_of_day: '07:00' },
        completion_source: 'self_report',
        goal_id: 'g1',
      },
    ]);
    getUser.mockResolvedValue({ pending_plan: null });
  });

  /** The live incident, replayed with the fix: one call, and the card holds ONLY the correction. */
  it('replaces the wrong card with one holding only the corrected edits', async () => {
    await propose.run('u1', { edits: [WRONG_ADD] });
    const [, wrong] = setPendingPlan.mock.calls[0]!;
    expect(wrong.rationale).toBe('Add Stretching — Mon, Wed, Fri, 07:00');
    getUser.mockResolvedValue({ pending_plan: wrong });
    setPendingPlan.mockClear();

    const out = await propose.run('u1', {
      start_over: true,
      edits: [{ action: 'add', title: 'Stretching', days: ['wednesday'], time_of_day: '07:00' }],
    });

    // Cleared BEFORE applying — the same null the dismiss route writes — then the fresh card.
    expect(setPendingPlan.mock.calls[0]).toEqual(['u1', null]);
    const [, redone] = setPendingPlan.mock.calls[1]!;
    expect(redone.rationale).toBe('Add Stretching — Wed, 07:00');
    const stretches = redone.activities.filter((a: { title: string }) => a.title === 'Stretching');
    expect(stretches).toHaveLength(1);
    expect(stretches[0].recurrence).toBe('FREQ=WEEKLY;BYDAY=WE');
    expect(out).toMatch(/Redone — the old card is gone/);
    expect(out).toMatch(/ONLY this/);
    expect(out).not.toMatch(/Mon, Wed, Fri/);
  });

  it('clears the card and says so when start_over comes with no edits', async () => {
    getUser.mockResolvedValue({
      pending_plan: {
        activities: [{ title: 'Stretching' }],
        note: '',
        rationale: 'Add Stretching — Mon, Wed, Fri, 07:00',
        goal_ids: [],
        created_at: 'x',
      },
    });
    const out = await propose.run('u1', { start_over: true, edits: [] });
    expect(setPendingPlan).toHaveBeenCalledWith('u1', null);
    expect(out).toMatch(/Cleared — the proposal card is gone/);
    expect(out).toMatch(/plan itself is untouched/);
  });

  it('says there was nothing to clear when no card is up', async () => {
    const out = await propose.run('u1', { start_over: true, edits: [] });
    expect(out).toMatch(/no proposal card up/);
  });

  /** The user asked for the wrong card to GO; a failed redo must not quietly resurrect it. */
  it('does not leave the wrong card standing when the redo itself fails', async () => {
    await propose.run('u1', { edits: [WRONG_ADD] });
    const [, wrong] = setPendingPlan.mock.calls[0]!;
    getUser.mockResolvedValue({ pending_plan: wrong });
    setPendingPlan.mockClear();

    // The corrected add forgets its time — rejected, so nothing fresh lands.
    const out = await propose.run('u1', {
      start_over: true,
      edits: [{ action: 'add', title: 'Stretching', days: ['wednesday'] }],
    });
    expect(setPendingPlan).toHaveBeenCalledTimes(1);
    expect(setPendingPlan).toHaveBeenCalledWith('u1', null);
    expect(out).toMatch(/old card WAS cleared/);
    expect(out).toMatch(/no card is up at all now/);
  });

  /** Surgery on the card without a reset: a wrong add comes OFF by handle, the rest stays. */
  it('can take a wrong add off the standing card by its new1 handle', async () => {
    await propose.run('u1', {
      edits: [{ action: 'move', activities: ['aaaaaaaa'], days: ['friday'] }, WRONG_ADD],
    });
    const [, first] = setPendingPlan.mock.calls[0]!;
    getUser.mockResolvedValue({ pending_plan: first });
    setPendingPlan.mockClear();

    const out = await propose.run('u1', { edits: [{ action: 'remove', activities: ['new1'] }] });
    const [, second] = setPendingPlan.mock.calls[0]!;
    expect(second.activities.map((a: { title: string }) => a.title)).toEqual(['Easy run']);
    expect(second.rationale).toMatch(/Drop Stretching/);
    // The earlier real change survives — this is one edit off the card, not a reset.
    expect(second.rationale).toMatch(/Move Easy run/);
    expect(out).toMatch(/Added to the card already up/);
  });

  it('still accumulates when start_over is false or absent', async () => {
    await propose.run('u1', {
      edits: [{ action: 'add', title: 'Stretching', days: ['wednesday'], time_of_day: '07:00' }],
    });
    const [, first] = setPendingPlan.mock.calls[0]!;
    getUser.mockResolvedValue({ pending_plan: first });

    const out = await propose.run('u1', {
      start_over: false,
      edits: [{ action: 'resize', activities: ['aaaaaaaa'], duration_min: 45 }],
    });
    const [, second] = setPendingPlan.mock.calls[1]!;
    expect(second.rationale).toMatch(/Add Stretching — Wed, 07:00/);
    expect(second.rationale).toMatch(/45 min/);
    expect(out).toMatch(/Added to the card already up/);
  });

  it('teaches the redo in the schema, not just in code', () => {
    const def = coachActionDefinitions().find((d) => d.function.name === 'propose_plan_change')!;
    expect(def.function.description).toMatch(/"start_over"/);
    expect(def.function.description).toMatch(/never add a fix beside it/);
    const props = (def.function.parameters as { properties: Record<string, { type?: string; description?: string }> })
      .properties;
    expect(props.start_over!.type).toBe('boolean');
    expect(props.start_over!.description).toMatch(/ONLY this call/);
  });
});
