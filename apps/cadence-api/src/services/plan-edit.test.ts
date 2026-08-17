import { describe, expect, it } from 'vitest';
import type { Activity } from '@cadence/shared';
import { activityHandle, applyPlanEdits, matchActivity } from './plan-edit.ts';

/**
 * The edit engine decides what a person's week becomes, with no model in the loop and no human
 * reading the result before it is offered. So the cases that matter here are the ones where being
 * wrong is quiet: an edit that hits the wrong session, an edit that silently does nothing, or a
 * change that drags the rest of the plan along with it.
 */

/** Real-shaped uuids, because the handle is the first 8 hex of one. */
let seq = 0;
const uuid = () => `${(++seq).toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;

const act = (over: Partial<Activity> & { title: string }): Activity => ({
  activity_id: uuid(),
  // The handle is derived from THIS, not activity_id (0036) — a commitment outlives its rows.
  commitment_id: uuid(),
  plan_id: 'p1',
  kind: 'user',
  schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TH', duration_min: 40 },
  completion_source: 'self_report',
  ...over,
});

const PLAN: Activity[] = [
  act({ title: 'Easy run', goal_id: 'g1' }),
  act({ title: 'Long run', schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=SU', duration_min: 90 }, goal_id: 'g1' }),
  act({ title: 'Sit', schedule: { recurrence: 'FREQ=DAILY', duration_min: 10 }, goal_id: 'g2' }),
];
const GOALS = { g1: 'Run a 10k', g2: 'A steadier mind' };

describe('applyPlanEdits', () => {
  it('moves one session and leaves every other one exactly as it was', () => {
    const r = applyPlanEdits(PLAN, [{ action: 'move', activity: 'Easy run', days: ['friday'] }], GOALS);
    expect(r.rejected).toEqual([]);
    // Day names match the rest of the plan UI (describeRecurrence's vocabulary), not prose.
    expect(r.changes).toEqual(['Move Easy run: Thu → Fri']);
    const run = r.activities.find((a) => a.title === 'Easy run')!;
    expect(run.recurrence).toBe('FREQ=WEEKLY;BYDAY=FR');
    // The blast radius is the whole point: nothing else may drift.
    expect(r.activities.find((a) => a.title === 'Long run')!.recurrence).toBe('FREQ=WEEKLY;BYDAY=SU');
    expect(r.activities.find((a) => a.title === 'Sit')!.duration_min).toBe(10);
    expect(r.activities).toHaveLength(3);
  });

  it('applies several edits to the same session in the order given', () => {
    const r = applyPlanEdits(
      PLAN,
      [
        { action: 'move', activity: 'Easy run', days: ['mon', 'wed'] },
        { action: 'resize', activity: 'Easy run', duration_min: 20 },
      ],
      GOALS,
    );
    const run = r.activities.find((a) => a.title === 'Easy run')!;
    expect(run.recurrence).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
    expect(run.duration_min).toBe(20);
    expect(r.changes).toHaveLength(2);
  });

  it('keeps the interval when it moves a fortnightly session', () => {
    const fortnightly = [act({ title: 'Long ride', schedule: { recurrence: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA' } })];
    const r = applyPlanEdits(fortnightly, [{ action: 'move', activity: 'Long ride', days: ['sunday'] }]);
    expect(r.activities[0]!.recurrence).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=SU');
  });

  it('refuses an ambiguous name rather than changing the wrong session', () => {
    // "run" matches both Easy run and Long run — a coin flip here edits someone's real week.
    const r = applyPlanEdits(PLAN, [{ action: 'remove', activity: 'run' }], GOALS);
    expect(r.changes).toEqual([]);
    expect(r.rejected[0]).toMatch(/Nothing in the plan clearly matches "run"/);
    expect(r.activities).toHaveLength(3);
  });

  it('applies the edits it understands and reports the ones it does not', () => {
    const r = applyPlanEdits(
      PLAN,
      [
        { action: 'remove', activity: 'Long run' },
        { action: 'move', activity: 'Yoga', days: ['tuesday'] },
      ],
      GOALS,
    );
    expect(r.changes).toEqual(['Drop Long run']);
    expect(r.rejected).toHaveLength(1);
    expect(r.activities.map((a) => a.title)).toEqual(['Easy run', 'Sit']);
  });

  it('adds a commitment, attributed to the goal it serves', () => {
    const r = applyPlanEdits(
      PLAN,
      [{ action: 'add', title: 'Easy walk', days: ['saturday'], duration_min: 30, goal_title: 'A steadier mind' }],
      GOALS,
    );
    const walk = r.activities.find((a) => a.title === 'Easy walk')!;
    expect(walk.recurrence).toBe('FREQ=WEEKLY;BYDAY=SA');
    expect(walk.goal_id).toBe('g2');
    expect(walk.suggested).toBe(true);
    expect(r.changes[0]).toBe('Add Easy walk — Sat');
  });

  it('rejects an edit whose numbers make no sense instead of writing them', () => {
    const r = applyPlanEdits(PLAN, [{ action: 'resize', activity: 'Sit', duration_min: 0 }], GOALS);
    expect(r.changes).toEqual([]);
    expect(r.rejected[0]).toMatch(/how long/);
    expect(r.activities.find((a) => a.title === 'Sit')!.duration_min).toBe(10);
  });

  it('carries the coach rationale and goal grouping through untouched activities', () => {
    const withWhy = [act({ title: 'Sit', why: 'Ten minutes is a rhythm you can keep on a bad day.', goal_id: 'g2' })];
    const r = applyPlanEdits(withWhy, [{ action: 'retime', activity: 'Sit', time_of_day: '07:00' }], GOALS);
    expect(r.activities[0]!.why).toBe('Ten minutes is a rhythm you can keep on a bad day.');
    expect(r.activities[0]!.goal_title).toBe('A steadier mind');
    expect(r.activities[0]!.time_of_day).toBe('07:00');
  });
});

/**
 * `rework` — changing what a session CONTAINS without touching its slot.
 *
 * The gap it closes, from the chat of 2026-08-16: "let's start by changing the farmer carries to
 * dead hangs". Every other action here is structural, so the one edit the user actually asked for
 * was the one thing the coach could not do — she discussed it, offered to make it permanent, and
 * had nowhere to put the answer. `how_to` is the right home because prescribe-session already
 * reads it, which is what makes "permanent" mean permanent.
 */
describe('applyPlanEdits — rework', () => {
  const GRIP: Activity[] = [
    act({ title: 'Grip finisher', how_to: 'Farmers carries, 3 x 40m', goal_id: 'g1' }),
    act({ title: 'Easy run', goal_id: 'g1' }),
  ];

  it('swaps what the session contains and leaves its slot untouched', () => {
    const r = applyPlanEdits(
      GRIP,
      [{ action: 'rework', activity: 'Grip finisher', how_to: 'Dead hangs, 3-4 x 20-30s' }],
      GOALS,
    );
    expect(r.rejected).toEqual([]);
    const grip = r.activities.find((a) => a.title === 'Grip finisher')!;
    expect(grip.how_to).toBe('Dead hangs, 3-4 x 20-30s');
    // The slot is the part that must NOT move — this is the difference from a rebuild.
    expect(grip.recurrence).toBe('FREQ=WEEKLY;BYDAY=TH');
    expect(grip.duration_min).toBe(40);
    expect(r.activities).toHaveLength(2);
  });

  it('says what changed in the words the card will show', () => {
    const r = applyPlanEdits(GRIP, [{ action: 'rework', activity: 'Grip finisher', how_to: 'Dead hangs' }], GOALS);
    expect(r.changes).toEqual(['Grip finisher: Dead hangs']);
  });

  it('renames when the change earns a new name, and says both halves', () => {
    const r = applyPlanEdits(
      GRIP,
      [{ action: 'rework', activity: 'Grip finisher', title: 'Hang work', how_to: 'Dead hangs' }],
      GOALS,
    );
    expect(r.changes).toEqual(['Grip finisher → Hang work: Dead hangs']);
    expect(r.activities.find((a) => a.title === 'Hang work')).toBeTruthy();
  });

  it('rejects an empty rework rather than quietly doing nothing', () => {
    const r = applyPlanEdits(GRIP, [{ action: 'rework', activity: 'Grip finisher' }], GOALS);
    expect(r.changes).toEqual([]);
    expect(r.rejected).toEqual(["Couldn't tell what Grip finisher should become."]);
  });

  it('will not guess which session was meant', () => {
    const r = applyPlanEdits(GRIP, [{ action: 'rework', activity: 'the finisher thing', how_to: 'Dead hangs' }], GOALS);
    expect(r.changes).toEqual([]);
    expect(r.rejected[0]).toMatch(/Nothing in the plan clearly matches/);
  });

  /**
   * An instruction the person gave has to survive the NEXT edit, or "permanent" was a lie: a later
   * retime would otherwise rebuild the activity from scratch and drop how_to on the floor.
   */
  it('carries an existing how_to through an unrelated structural edit', () => {
    const r = applyPlanEdits(GRIP, [{ action: 'retime', activity: 'Grip finisher', time_of_day: '18:00' }], GOALS);
    expect(r.activities.find((a) => a.title === 'Grip finisher')!.how_to).toBe('Farmers carries, 3 x 40m');
  });
});

/**
 * Addressing by HANDLE — the fix for the whole class, not just the 2026-08-17 instance.
 *
 * Titles were the only handle an edit had, and titles are mutable, model-generated, and freely
 * duplicable, so "which one" was decided by a string match nobody could see. `get_active_plan` now
 * prints a handle beside every commitment and edits name it directly: exact, order-independent,
 * and plural, so "make all my runs 45 minutes" is one edit instead of three guesses.
 */
describe('applyPlanEdits — addressing by handle', () => {
  const RUNS: Activity[] = [
    act({ title: 'Easy run', schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU', duration_min: 60 } }),
    act({ title: 'Easy run', schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=WE', duration_min: 40 } }),
    act({ title: 'Long run', schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=SA', duration_min: 90 } }),
  ];
  const h = (i: number) => activityHandle(RUNS[i]!.commitment_id);

  it('hits exactly the commitment named, even when its twin is right beside it', () => {
    const r = applyPlanEdits(RUNS, [{ action: 'move', activities: [h(1)], days: ['friday'] }]);
    expect(r.rejected).toEqual([]);
    expect(r.changes).toEqual(['Move Easy run: Wed → Fri']);
    // Tuesday's is untouched. No on_days, no prose, no guessing.
    expect(r.activities[0]!.recurrence).toBe('FREQ=WEEKLY;BYDAY=TU');
    expect(r.activities[1]!.recurrence).toBe('FREQ=WEEKLY;BYDAY=FR');
  });

  /** The one-shot case: every run in the week, one edit, one card. */
  it('changes several commitments in a single edit, one card line each', () => {
    const r = applyPlanEdits(RUNS, [{ action: 'resize', activities: [h(0), h(1), h(2)], duration_min: 45 }]);
    expect(r.rejected).toEqual([]);
    expect(r.changes).toEqual(['Easy run: 60 min → 45 min', 'Easy run: 40 min → 45 min', 'Long run: 90 min → 45 min']);
    expect(r.activities.every((a) => a.duration_min === 45)).toBe(true);
  });

  it('rejects an unknown handle outright and hands back the real ones', () => {
    const r = applyPlanEdits(RUNS, [{ action: 'remove', activities: ['deadbeef'] }]);
    expect(r.changes).toEqual([]);
    expect(r.rejected[0]).toMatch(/No commitment has the handle "deadbeef"/);
    expect(r.rejected[0]).toContain(h(0));
    expect(r.rejected[0]).toMatch(/get_active_plan again/);
    expect(r.activities).toHaveLength(3);
  });

  /** All-or-nothing per edit: a partly-resolvable batch must not half-apply to someone's week. */
  it('does not apply the known half of an edit whose other half is unknown', () => {
    const r = applyPlanEdits(RUNS, [{ action: 'resize', activities: [h(0), 'deadbeef'], duration_min: 30 }]);
    expect(r.changes).toEqual([]);
    expect(r.activities[0]!.duration_min).toBe(60);
  });

  it('never falls back to the title when a handle was given', () => {
    // "Easy run" would have matched something under the old rules; a bad handle must not.
    const r = applyPlanEdits(RUNS, [{ action: 'move', activities: ['00000000'], activity: 'Easy run', days: ['fri'] }]);
    expect(r.changes).toEqual([]);
    expect(r.rejected[0]).toMatch(/No commitment has the handle/);
  });

  it('ignores a handle repeated in one edit rather than applying twice', () => {
    const r = applyPlanEdits(RUNS, [{ action: 'resize', activities: [h(2), h(2)], duration_min: 50 }]);
    expect(r.changes).toEqual(['Long run: 90 min → 50 min']);
  });

  it('gives a freshly added commitment a handle, so the next edit can reach it', () => {
    const r = applyPlanEdits(RUNS, [
      { action: 'add', title: 'Recovery jog', days: ['sunday'] },
      { action: 'resize', activities: ['new1'], duration_min: 25 },
    ]);
    expect(r.rejected).toEqual([]);
    expect(r.activities.find((a) => a.title === 'Recovery jog')!.duration_min).toBe(25);
  });
});

describe('matchActivity', () => {
  it('prefers an exact title over a containing one', () => {
    const items = [{ title: 'Run' }, { title: 'Run club' }];
    expect(matchActivity(items, 'Run')?.title).toBe('Run');
  });

  it('matches a partial name when only one thing could be meant', () => {
    expect(matchActivity(PLAN, 'sit')?.title).toBe('Sit');
    expect(matchActivity(PLAN, 'Easy')?.title).toBe('Easy run');
  });

  it('returns nothing for an empty or unmatched query', () => {
    expect(matchActivity(PLAN, '  ')).toBeNull();
    expect(matchActivity(PLAN, 'swimming')).toBeNull();
  });

  /**
   * The exact branch used to be `.find()` — first of N twins wins, silently. On 2026-08-17 that
   * chose Tuesday's "Easy run" over Wednesday's and moved the wrong one to Friday, five times,
   * while the model's arguments never said Tuesday at all. Two of a name is a question, not a pick.
   */
  it('refuses to choose between two commitments with the identical title', () => {
    const twins = [{ title: 'Easy run' }, { title: 'Easy run' }];
    expect(matchActivity(twins, 'Easy run')).toBeNull();
  });
});

/**
 * The 2026-08-17 incident, end to end.
 *
 * One applied card renamed Tuesday's run to "Easy run" AND added a Wednesday "Easy run" beside it.
 * The user then asked to move the WEDNESDAY one to Friday; the coach called
 * `move "Easy run" ["friday"]` and the engine's first-match-wins pick moved TUESDAY's. She retried
 * five times, pushing "the Wednesday one" into `why` and `how_to` — fields the move path never
 * reads — because the schema had no way to say it. These tests are that way.
 */
describe('applyPlanEdits — twins and on_days', () => {
  const TWINS: Activity[] = [
    act({
      title: 'Easy run',
      schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU', time_of_day: '19:00', duration_min: 60 },
    }),
    act({ title: 'Easy run', schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=WE', duration_min: 40 } }),
    act({ title: 'Long run', schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=SA', duration_min: 90 } }),
  ];

  it('moves the one its current days name, and only that one', () => {
    const r = applyPlanEdits(TWINS, [
      { action: 'move', activity: 'Easy run', on_days: ['wednesday'], days: ['friday'] },
    ]);
    expect(r.rejected).toEqual([]);
    expect(r.changes).toEqual(['Move Easy run: Wed → Fri']);
    const recurrences = r.activities.filter((a) => a.title === 'Easy run').map((a) => a.recurrence);
    // Tuesday's run has NOT moved. That is the entire incident.
    expect(recurrences).toContain('FREQ=WEEKLY;BYDAY=TU');
    expect(recurrences).toContain('FREQ=WEEKLY;BYDAY=FR');
  });

  it('refuses a bare title that names twins, and says how to disambiguate', () => {
    const r = applyPlanEdits(TWINS, [{ action: 'move', activity: 'Easy run', days: ['friday'] }]);
    expect(r.changes).toEqual([]);
    expect(r.rejected[0]).toMatch(/2 commitments are called "Easy run"/);
    // The guidance now points at the exact handle, not at another way to describe the thing.
    expect(r.rejected[0]).toMatch(/address the one you mean by its handle/);
    // Nothing moved — refusing is the fix; guessing was the bug.
    expect(r.activities.map((a) => a.recurrence)).toEqual(TWINS.map((a) => a.schedule.recurrence));
  });

  it('rejects on_days that match nothing rather than falling back to a guess', () => {
    const r = applyPlanEdits(TWINS, [{ action: 'move', activity: 'Easy run', on_days: ['monday'], days: ['friday'] }]);
    expect(r.changes).toEqual([]);
    expect(r.rejected[0]).toMatch(/on monday/);
  });

  it('on_days works for a singleton too — "the Saturday run" is just precise', () => {
    const r = applyPlanEdits(TWINS, [
      { action: 'resize', activity: 'Long run', on_days: ['saturday'], duration_min: 75 },
    ]);
    expect(r.changes).toEqual(['Long run: 90 min → 75 min']);
  });

  it('will not ADD a twin — the pair above should never have been creatable', () => {
    const r = applyPlanEdits(PLAN, [{ action: 'add', title: 'Easy run', days: ['wednesday'] }], GOALS);
    expect(r.changes).toEqual([]);
    expect(r.rejected[0]).toMatch(/already names a commitment/);
    expect(r.activities.filter((a) => a.title === 'Easy run')).toHaveLength(1);
  });

  it('will not RENAME into a twin either — how this pair was actually born', () => {
    const plan = [act({ title: 'Easy base run - post-recovery assessment' }), act({ title: 'Easy run' })];
    const r = applyPlanEdits(plan, [
      { action: 'rework', activity: 'Easy base run - post-recovery assessment', title: 'Easy run' },
    ]);
    expect(r.changes).toEqual([]);
    expect(r.rejected[0]).toMatch(/two identical rows/);
  });

  /** She passed duration_min on a rework twice and both were silently dropped — the "35-40 minute
   *  easy run" she described stayed 60 minutes in the plan. A field the schema accepts must act. */
  it('rework honours duration_min instead of silently dropping it', () => {
    const r = applyPlanEdits(TWINS, [
      {
        action: 'rework',
        activity: 'Easy run',
        on_days: ['tuesday'],
        how_to: 'Easy conversational pace, 4-5km',
        duration_min: 40,
      },
    ]);
    expect(r.rejected).toEqual([]);
    const tue = r.activities.find((a) => a.recurrence === 'FREQ=WEEKLY;BYDAY=TU')!;
    expect(tue.duration_min).toBe(40);
    expect(tue.how_to).toBe('Easy conversational pace, 4-5km');
    expect(r.changes[0]).toMatch(/60 → 40 min/);
  });
});
