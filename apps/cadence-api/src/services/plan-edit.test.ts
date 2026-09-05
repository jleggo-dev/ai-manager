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
    expect(r.changes).toEqual(['Move Easy run: Thu → Fri, no time set']);
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
    expect(r.changes).toEqual(['Drop Long run (Sun, no time set)']);
    expect(r.rejected).toHaveLength(1);
    expect(r.activities.map((a) => a.title)).toEqual(['Easy run', 'Sit']);
  });

  it('adds a commitment, attributed to the goal it serves', () => {
    const r = applyPlanEdits(
      PLAN,
      [
        {
          action: 'add',
          title: 'Easy walk',
          days: ['saturday'],
          duration_min: 30,
          time_of_day: '09:00',
          goal_title: 'A steadier mind',
        },
      ],
      GOALS,
    );
    const walk = r.activities.find((a) => a.title === 'Easy walk')!;
    expect(walk.recurrence).toBe('FREQ=WEEKLY;BYDAY=SA');
    expect(walk.goal_id).toBe('g2');
    expect(walk.suggested).toBe(true);
    expect(r.changes[0]).toBe('Add Easy walk — Sat, 09:00');
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
    expect(r.changes).toEqual(['Grip finisher (Thu, no time set): Dead hangs']);
  });

  it('renames when the change earns a new name, and says both halves', () => {
    const r = applyPlanEdits(
      GRIP,
      [{ action: 'rework', activity: 'Grip finisher', title: 'Hang work', how_to: 'Dead hangs' }],
      GOALS,
    );
    expect(r.changes).toEqual(['Grip finisher (Thu, no time set) → Hang work: Dead hangs']);
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
    expect(r.changes).toEqual(['Move Easy run: Wed → Fri, no time set']);
    // Tuesday's is untouched. No on_days, no prose, no guessing.
    expect(r.activities[0]!.recurrence).toBe('FREQ=WEEKLY;BYDAY=TU');
    expect(r.activities[1]!.recurrence).toBe('FREQ=WEEKLY;BYDAY=FR');
  });

  /** The one-shot case: every run in the week, one edit, one card. */
  it('changes several commitments in a single edit, one card line each', () => {
    const r = applyPlanEdits(RUNS, [{ action: 'resize', activities: [h(0), h(1), h(2)], duration_min: 45 }]);
    expect(r.rejected).toEqual([]);
    expect(r.changes).toEqual([
      'Easy run (Tue, no time set): 60 min → 45 min',
      'Easy run (Wed, no time set): 40 min → 45 min',
      'Long run (Sat, no time set): 90 min → 45 min',
    ]);
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
    expect(r.changes).toEqual(['Long run (Sat, no time set): 90 min → 50 min']);
  });

  it('gives a freshly added commitment a handle, so the next edit can reach it', () => {
    const r = applyPlanEdits(RUNS, [
      { action: 'add', title: 'Recovery jog', days: ['sunday'], time_of_day: '10:00' },
      { action: 'resize', activities: ['new1'], duration_min: 25 },
    ]);
    expect(r.rejected).toEqual([]);
    expect(r.activities.find((a) => a.title === 'Recovery jog')!.duration_min).toBe(25);
  });
});

/**
 * A card must mean something is different.
 *
 * 2026-08-17: the owner asked her to fix two run lengths, she resized both to the value they
 * ALREADY held, and the tool reported "Easy run: 40 min → 40 min" twice as changes. That wrote a
 * pending plan and raised an Apply button; he tapped it and committed plan v10 byte-identical to
 * v9 across all sixteen activities — stored rationale literally those two lines — while wiping and
 * regenerating ten prescribed sessions. She had promised a fix, shown a card, and delivered
 * nothing, which from his side is indistinguishable from the tool being broken.
 */
describe('applyPlanEdits — an edit that changes nothing is not a change', () => {
  const PLAN2: Activity[] = [
    act({
      title: 'Easy run',
      schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU', duration_min: 40, time_of_day: '19:00' },
    }),
  ];

  it('reports a resize to the value it already holds as a no-op, not a change', () => {
    const r = applyPlanEdits(PLAN2, [{ action: 'resize', activity: 'Easy run', duration_min: 40 }]);
    expect(r.changes).toEqual([]);
    expect(r.rejected).toEqual([]);
    expect(r.noops).toEqual(['Easy run (Tue, 19:00) is already 40 min.']);
  });

  it('still reports a real resize', () => {
    const r = applyPlanEdits(PLAN2, [{ action: 'resize', activity: 'Easy run', duration_min: 50 }]);
    expect(r.changes).toEqual(['Easy run (Tue, 19:00): 40 min → 50 min']);
    expect(r.noops).toEqual([]);
  });

  it('treats a retime to the same time as a no-op', () => {
    const r = applyPlanEdits(PLAN2, [{ action: 'retime', activity: 'Easy run', time_of_day: '19:00' }]);
    expect(r.changes).toEqual([]);
    expect(r.noops).toEqual(['Easy run (Tue) is already at 19:00.']);
  });

  it('treats a move to the days it already runs on as a no-op', () => {
    const r = applyPlanEdits(PLAN2, [{ action: 'move', activity: 'Easy run', days: ['tuesday'] }]);
    expect(r.changes).toEqual([]);
    expect(r.noops).toEqual(['Easy run is already on Tue, 19:00.']);
  });

  /** A mixed batch keeps the real change and quietly drops the redundant one. */
  it('separates the real change from the redundant one in the same batch', () => {
    const two: Activity[] = [
      ...PLAN2,
      act({ title: 'Long run', schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=SA', duration_min: 90 } }),
    ];
    const r = applyPlanEdits(two, [
      { action: 'resize', activity: 'Easy run', duration_min: 40 },
      { action: 'resize', activity: 'Long run', duration_min: 75 },
    ]);
    expect(r.changes).toEqual(['Long run (Sat, no time set): 90 min → 75 min']);
    expect(r.noops).toEqual(['Easy run (Tue, 19:00) is already 40 min.']);
  });
});

/**
 * `add` dropped `how_to` on the floor — the same class as the rework/duration_min bug, and it bit
 * for the same reason: the field is accepted by the schema and never carried. She passed
 * "Easy conversational pace, roughly 4-5km" on a new run and it vanished, so prescribe-session —
 * which reads how_to directly — went back to guessing and wrote a 25-minute run inside a
 * 40-minute session.
 */
describe('applyPlanEdits — add carries what it was given', () => {
  it('keeps how_to on a newly added commitment', () => {
    const r = applyPlanEdits(
      [],
      [
        {
          action: 'add',
          title: 'Easy run',
          days: ['tuesday'],
          duration_min: 50,
          how_to: 'Easy conversational pace, roughly 4-5km',
          time_of_day: '07:00',
        },
      ],
    );
    const added = r.activities.find((a) => a.title === 'Easy run')!;
    expect(added.how_to).toBe('Easy conversational pace, roughly 4-5km');
    expect(added.duration_min).toBe(50);
    expect(added.time_of_day).toBe('07:00');
  });

  /**
   * The card never showed the time even when she set one — both of the owner's adds rendered as
   * "Add Easy run — Fri" though one carried time_of_day "morning". He read that as the UI not
   * specifying when, which is exactly what it was doing.
   */
  it('shows the time on the card', () => {
    const r = applyPlanEdits([], [{ action: 'add', title: 'Easy run', days: ['tuesday'], time_of_day: '07:00' }]);
    expect(r.changes[0]).toBe('Add Easy run — Tue, 07:00');
  });

  /**
   * "No particular time" must be a CHOICE, not an omission. On 2026-08-17 she supplied a time on
   * one add and dropped it on a redo 29 seconds later, and nothing could tell the two apart.
   */
  it('refuses an add that never says when', () => {
    const r = applyPlanEdits([], [{ action: 'add', title: 'Easy run', days: ['tuesday'] }]);
    expect(r.changes).toEqual([]);
    expect(r.activities).toHaveLength(0);
    expect(r.rejected[0]).toMatch(/time_of_day is required/);
    expect(r.rejected[0]).toMatch(/"anytime"/);
    // Facts, not picks (owner 2026-09-03): the reject names the contract and where the times
    // already on file can be read. It never hands her a rule for choosing one.
    expect(r.rejected[0]).not.toMatch(/the time their other sessions of that kind run at/);
    expect(r.rejected[0]).not.toMatch(/or ask them/);
    expect(r.rejected[0]).toMatch(/get_active_plan/);
  });

  /**
   * An add with no days named used to become Monday, Wednesday, Friday — silently, with nothing
   * telling her or the user it had happened. Days is a fact she has or does not have; a default
   * is the omission wearing a nicer name (owner 2026-09-03, facts not picks).
   */
  it('refuses an add that never says which days, instead of defaulting to Mon/Wed/Fri', () => {
    const r = applyPlanEdits([], [{ action: 'add', title: 'Easy run', time_of_day: '07:00' }]);
    expect(r.changes).toEqual([]);
    expect(r.activities).toHaveLength(0);
    expect(r.rejected[0]).toMatch(/days is required/);
    expect(r.rejected.join(' ')).not.toMatch(/MO,WE,FR/);
  });

  it('refuses an add whose days are all unreadable, rather than guessing three of them', () => {
    const r = applyPlanEdits([], [{ action: 'add', title: 'Easy run', days: ['someday'], time_of_day: '07:00' }]);
    expect(r.activities).toHaveLength(0);
    expect(r.rejected[0]).toMatch(/days is required/);
  });

  it('accepts a deliberate "anytime", and says so in words on the card', () => {
    const r = applyPlanEdits([], [{ action: 'add', title: 'Easy run', days: ['tuesday'], time_of_day: 'anytime' }]);
    expect(r.rejected).toEqual([]);
    expect(r.changes[0]).toBe('Add Easy run — Tue, any time');
    // Stored as the sentinel, which sorts after every clock time so it still settles to the
    // bottom of its day.
    expect(r.activities[0]!.time_of_day).toBe('anytime');
  });

  it('collapses the ways she might phrase "no particular time"', () => {
    for (const said of ['any time', 'Whenever', 'flexible', 'ANY']) {
      const r = applyPlanEdits([], [{ action: 'add', title: 'Sit', days: ['monday'], time_of_day: said }]);
      expect(r.activities[0]!.time_of_day).toBe('anytime');
    }
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
    expect(r.changes).toEqual(['Move Easy run: Wed → Fri, no time set']);
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
    expect(r.changes).toEqual(['Long run (Sat, no time set): 90 min → 75 min']);
  });

  it('will not ADD a twin — the pair above should never have been creatable', () => {
    const r = applyPlanEdits(PLAN, [{ action: 'add', title: 'Easy run', days: ['wednesday'] }], GOALS);
    expect(r.changes).toEqual([]);
    expect(r.rejected[0]).toMatch(/already names a commitment/);
    expect(r.rejected[0]).toMatch(/Pick a distinct name\./);
    // The uniqueness rule is contract; the two worked examples were a steer on what to call it.
    expect(r.rejected[0]).not.toMatch(/\(Wednesday\)/);
    expect(r.rejected[0]).not.toMatch(/— hills/);
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

/**
 * Editing the standing proposal — the `base` parameter's own bugs.
 *
 * Accumulation (2026-08-17's fix) made a second call build on the card instead of destroying it,
 * and thereby created the inverse trap, live on 2026-08-18: asked for Wednesday-only stretching
 * the coach added "Stretching — Mon, Wed, Fri", noticed, said "let me redo it properly" — and the
 * redo ADDED beside the mistake. Two holes made that inescapable: a proposal-only add lost its
 * `new1` handle the moment the call that created it returned (the next call rejected the handle
 * and listed the add as "? (title)"), and the name-collision rejection steered her to a renamed
 * twin rather than out. These tests are the two doors.
 */
describe('applyPlanEdits — a proposal-only add stays addressable', () => {
  const COMMITTED: Activity[] = [act({ title: 'Easy run' })];
  /** The stored pending card after "add Stretching": the add carries no commitment_id yet. */
  const standingCard = () =>
    applyPlanEdits(COMMITTED, [
      { action: 'add', title: 'Stretching', days: ['mon', 'wed', 'fri'], time_of_day: '07:00' },
    ]).activities;

  it('removes a same-call add by its new1 handle', () => {
    const r = applyPlanEdits(COMMITTED, [
      { action: 'add', title: 'Stretching', days: ['wed'], time_of_day: '07:00' },
      { action: 'remove', activities: ['new1'] },
    ]);
    expect(r.rejected).toEqual([]);
    expect(r.activities.map((a) => a.title)).toEqual(['Easy run']);
  });

  it('still answers to new1 on the NEXT call, once the card is the base', () => {
    const r = applyPlanEdits(COMMITTED, [{ action: 'remove', activities: ['new1'] }], {}, standingCard());
    expect(r.rejected).toEqual([]);
    expect(r.changes).toEqual(['Drop Stretching (Mon, Wed, Fri, 07:00)']);
    expect(r.activities.map((a) => a.title)).toEqual(['Easy run']);
  });

  it('answers to its title across calls too', () => {
    const r = applyPlanEdits(COMMITTED, [{ action: 'remove', activity: 'Stretching' }], {}, standingCard());
    expect(r.rejected).toEqual([]);
    expect(r.activities.map((a) => a.title)).toEqual(['Easy run']);
  });

  it('names new1 among the real handles when an unknown handle is refused', () => {
    const r = applyPlanEdits(COMMITTED, [{ action: 'remove', activities: ['deadbeef'] }], {}, standingCard());
    // Used to print "? (Stretching)" — a handle list offering a handle nobody could use.
    expect(r.rejected[0]).toMatch(/new1 \(Stretching\)/);
    expect(r.activities).toHaveLength(2);
  });

  it('steers a proposal name-collision to start_over, not to a renamed twin', () => {
    const r = applyPlanEdits(
      COMMITTED,
      [{ action: 'add', title: 'Stretching', days: ['wed'], time_of_day: '07:00' }],
      {},
      standingCard(),
    );
    expect(r.changes).toEqual([]);
    expect(r.rejected[0]).toMatch(/already names a commitment/);
    expect(r.rejected[0]).toMatch(/start_over/);
  });

  it('keeps the plain collision message when there is no proposal to start over from', () => {
    const r = applyPlanEdits(COMMITTED, [{ action: 'add', title: 'Easy run', days: ['wed'], time_of_day: '07:00' }]);
    expect(r.rejected[0]).toMatch(/already names a commitment/);
    expect(r.rejected[0]).not.toMatch(/start_over/);
  });
});

/**
 * The Changes surface's own fields: `reason` and `optional` land on the row an edit actually
 * changes — `change_reason` and `enabled` on the resulting `PendingPlanActivity` — for the swap
 * card the coach persists the moment she offers a change (step 7's client half). Every action but
 * `remove` carries them; `remove` deletes its row outright, so there is nothing left to attach
 * either to.
 */
describe('applyPlanEdits — reason and optional (the swap card)', () => {
  const REASON = "You've made 4 of 4 morning sessions this month and 1 of 4 evening ones.";

  it('attaches a reason to the row a move actually changes', () => {
    const r = applyPlanEdits(PLAN, [{ action: 'move', activity: 'Easy run', days: ['friday'], reason: REASON }], GOALS);
    expect(r.activities.find((a) => a.title === 'Easy run')!.change_reason).toBe(REASON);
  });

  it('marks an add optional — `enabled: false`, the take-it-or-leave-it default', () => {
    const r = applyPlanEdits(PLAN, [
      { action: 'add', title: 'Second strength day', days: ['saturday'], time_of_day: '09:00', optional: true },
    ]);
    expect(r.activities.find((a) => a.title === 'Second strength day')!.enabled).toBe(false);
  });

  it('an edit with neither field leaves change_reason and enabled untouched', () => {
    const r = applyPlanEdits(PLAN, [{ action: 'retime', activity: 'Sit', time_of_day: '07:00' }], GOALS);
    const sit = r.activities.find((a) => a.title === 'Sit')!;
    expect(sit.change_reason).toBeUndefined();
    expect(sit.enabled).toBeUndefined();
  });

  it('explicit `optional: false` writes `enabled: true`, not silence', () => {
    const r = applyPlanEdits(PLAN, [{ action: 'resize', activity: 'Sit', duration_min: 25, optional: false }], GOALS);
    expect(r.activities.find((a) => a.title === 'Sit')!.enabled).toBe(true);
  });

  it('caps a reason at 200 characters rather than storing an essay verbatim', () => {
    const long = 'x'.repeat(260);
    const r = applyPlanEdits(PLAN, [{ action: 'retime', activity: 'Sit', time_of_day: '07:00', reason: long }], GOALS);
    expect(r.activities.find((a) => a.title === 'Sit')!.change_reason).toHaveLength(200);
  });

  it('stamps every target the same way when one edit addresses several handles', () => {
    const runHandle = activityHandle(PLAN[0]!.commitment_id);
    const longHandle = activityHandle(PLAN[1]!.commitment_id);
    const r = applyPlanEdits(PLAN, [
      { action: 'resize', activities: [runHandle, longHandle], duration_min: 35, reason: REASON },
    ]);
    expect(r.activities.find((a) => a.title === 'Easy run')!.change_reason).toBe(REASON);
    expect(r.activities.find((a) => a.title === 'Long run')!.change_reason).toBe(REASON);
  });

  it('never attaches to a no-op — nothing changed, so there is nothing to explain', () => {
    const r = applyPlanEdits(PLAN, [{ action: 'resize', activity: 'Sit', duration_min: 10, reason: REASON }], GOALS);
    expect(r.noops).toHaveLength(1);
    expect(r.activities.find((a) => a.title === 'Sit')!.change_reason).toBeUndefined();
  });

  it('reports both as unread on remove — the row is gone, so neither field lands', () => {
    const r = applyPlanEdits(PLAN, [{ action: 'remove', activity: 'Sit', reason: REASON, optional: true }], GOALS);
    expect(r.changes).toEqual(['Drop Sit (Every day, no time set)']);
    expect(r.ignored.some((n) => n.includes('"reason"'))).toBe(true);
    expect(r.ignored.some((n) => n.includes('"optional"'))).toBe(true);
  });

  /**
   * `propose_plan_change` accumulates edits across calls onto one standing card (coach-actions.ts):
   * a FOLLOW-UP call that resizes the same row must not silently erase a reason an EARLIER call in
   * the same proposal already gave it.
   */
  it('a later edit to the same row, with neither field, keeps what an earlier call in this proposal set', () => {
    const firstCall = applyPlanEdits(
      PLAN,
      [{ action: 'move', activity: 'Easy run', days: ['friday'], reason: REASON }],
      GOALS,
    );
    const secondCall = applyPlanEdits(
      PLAN,
      [{ action: 'resize', activity: 'Easy run', duration_min: 20 }],
      GOALS,
      firstCall.activities,
    );
    const run = secondCall.activities.find((a) => a.title === 'Easy run')!;
    expect(run.duration_min).toBe(20);
    expect(run.change_reason).toBe(REASON);
  });
});
