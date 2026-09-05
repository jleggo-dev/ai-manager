import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Activity } from '@cadence/shared';
import { COACH_ACTION_TOOLS } from './coach-actions.ts';
import { activityHandle, applyPlanEdits, EDIT_FIELDS_READ, type PlanEdit, type PlanEditAction } from './plan-edit.ts';

/**
 * The contract between what the plan-edit surface ACCEPTS and what it actually does.
 *
 * Five bugs in one day (2026-08-17) were the same bug wearing different fields: the harness took
 * an input and threw it away without saying so. `rework` accepted `duration_min` and dropped it
 * (35, then 40 — the run stayed 60). `add` accepted `how_to` and dropped it, so session
 * generation went back to guessing. `on_days` was passed where `days` was meant and no-opped.
 * An action outside the enum is filtered out by `asEdits` with nothing reported. A `resize` to
 * the value already stored was rendered as a change.
 *
 * Every one was found days later by a person noticing an outcome was wrong. None was caught by a
 * test, because the tests asserted what the code DOES — so a field the code never read had no
 * test to fail. This file asserts the other thing: that nothing offered is thrown away.
 *
 * It is derived from the schema rather than from a list kept here, because a list kept here is
 * exactly what rots. Add a field to EDIT_SCHEMA and this file fails until you give it a probe
 * value; wire that field to no action and it fails again; claim in the field's own description
 * that an action honours it and then not honour it, and it fails a third time.
 *
 * Adding a tool or a field: docs/cadence/TOOL-HARNESS.md → "Adding a tool: the checklist".
 */

const HOW = 'see docs/cadence/TOOL-HARNESS.md → "Adding a tool: the checklist"';

// ---------------------------------------------------------------------------------------------
// Reaching the schema
// ---------------------------------------------------------------------------------------------

interface SchemaField {
  type?: string;
  description?: string;
  enum?: string[];
}

/**
 * `EDIT_SCHEMA` is not exported from coach-actions.ts — but it does not need to be. It reaches
 * the model through the tool definition, and that copy is the one worth auditing: it is the
 * promise the coach is actually shown. Read it there and the guard cannot drift from what ships.
 */
function readEditSchema(): { actions: string[]; fields: Record<string, SchemaField> } {
  const edits = COACH_ACTION_TOOLS.propose_plan_change?.parameters.properties.edits as
    { items?: { properties?: Record<string, SchemaField> } } | undefined;
  const properties = edits?.items?.properties;
  const actions = properties?.action?.enum;
  if (!properties || !actions?.length) {
    throw new Error(
      `propose_plan_change no longer offers an edits array with an action enum. This guard reads ` +
        `that schema to know what the model was promised — point it at the new shape (${HOW}).`,
    );
  }
  const { action: _action, ...fields } = properties;
  return { actions, fields };
}

const { actions: ACTIONS, fields: FIELDS } = readEditSchema();
const FIELD_NAMES = Object.keys(FIELDS);

// ---------------------------------------------------------------------------------------------
// A real plan, and one probe value per field
// ---------------------------------------------------------------------------------------------

/** Real-shaped uuids: the handle a coach addresses by is the first 8 hex of `commitment_id`. */
const uuid = (n: number) => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const RUN = uuid(1);
const RUN_HANDLE = activityHandle(RUN);

const PLAN: Activity[] = [
  {
    activity_id: uuid(11),
    commitment_id: RUN,
    plan_id: 'p1',
    title: 'Easy run',
    kind: 'user',
    schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TH', duration_min: 40 },
    completion_source: 'self_report',
    goal_id: 'g1',
  },
  {
    // Daily, so it is "on" every day — which is what makes an `on_days` probe bite.
    activity_id: uuid(12),
    commitment_id: uuid(2),
    plan_id: 'p1',
    title: 'Sit',
    kind: 'user',
    schedule: { recurrence: 'FREQ=DAILY', duration_min: 10 },
    completion_source: 'self_report',
    goal_id: 'g2',
  },
];
const GOAL_TITLES = { g1: 'Run a 10k', g2: 'A steadier mind' };

/**
 * One value per declared field, each chosen to be genuinely DIFFERENT from what the plan already
 * says — a probe equal to the stored value proves nothing, because a no-op looks identical to a
 * field that was never read.
 *
 * This map is the one hand-written thing here, and it is self-policing: a field added to the
 * schema without an entry fails the first test below by name.
 */
const PROBE: Record<string, unknown> = {
  activities: [RUN_HANDLE],
  activity: 'Easy run',
  on_days: ['monday'], // the run is on Thursday — naming Monday must change the outcome
  days: ['saturday'],
  time_of_day: '06:15',
  duration_min: 23,
  title: 'Hill repeats',
  how_to: 'Eight by ninety seconds, hard up, walk down',
  goal_title: 'Run a 10k',
  why: 'Because the last 2km is where it falls apart',
  // Neither has a stored value the plan already carries pre-edit, so either probe value is
  // genuinely different from "not set" — reason lands as `change_reason`, optional as `enabled`.
  reason: "You've made 4 of 4 morning sessions this month and 1 of 4 evening ones.",
  optional: true,
};

/** The smallest edit each action needs to be valid, minus any addressing. `add` carries days as
 *  well as a time: since the MO,WE,FR default was removed (facts, not picks — a silent default is
 *  the app deciding the week), an add that names no days is rejected, and a rejected base would
 *  make every other field on `add` look unread. */
const BASE: Record<string, Partial<PlanEdit>> = {
  move: { days: ['friday'] },
  retime: { time_of_day: '17:30' },
  resize: { duration_min: 55 },
  remove: {},
  add: { title: 'Sauna', days: ['tuesday'], time_of_day: '19:00' },
  rework: { how_to: 'Dead hangs instead of farmers carries' },
};

// ---------------------------------------------------------------------------------------------
// The probe: does setting this field change anything a person or the coach would see?
// ---------------------------------------------------------------------------------------------

/**
 * Build the edit twice — once without the field, once with it — over the same plan. Anything the
 * field is read for shows up as a difference: a different week, a different change line, a
 * rejection, a no-op note. No difference at all means the value went in and nothing came out.
 *
 * Addressing needs care: `activities` wins over `activity`, so an edit that already carries a
 * handle would make the title look unread. When the field under test IS the addressing, the base
 * carries none; when it is `on_days` (which only narrows the title fallback) the base addresses
 * by title so the probe is the only variable.
 */
function editFor(action: string, field: string, withField: boolean): PlanEdit {
  const edit: Record<string, unknown> = { action, ...BASE[action] };
  if (action !== 'add') {
    if (field === 'on_days') edit.activity = 'Easy run';
    else if (field !== 'activities' && field !== 'activity') edit.activities = [RUN_HANDLE];
  }
  delete edit[field];
  if (withField) edit[field] = PROBE[field];
  return edit as unknown as PlanEdit;
}

/** The applied result MINUS `ignored`: `READ` must mean the value reached the plan, a change
 *  line, a no-op or a rejection. An ignored-note is the opposite claim — counting it as "read"
 *  would let a note satisfy the tests that check a promised field actually LANDS. */
const outcome = (edit: PlanEdit) => {
  const { ignored: _ignored, ...applied } = applyPlanEdits(PLAN, [edit], GOAL_TITLES);
  return JSON.stringify(applied);
};

const isRead = (action: string, field: string): boolean =>
  outcome(editFor(action, field, false)) !== outcome(editFor(action, field, true));

/** `${action}/${field}` for every pair where the value demonstrably reached the result. */
const READ = new Set<string>();
for (const action of ACTIONS) {
  for (const field of FIELD_NAMES) if (isRead(action, field)) READ.add(`${action}/${field}`);
}

// ---------------------------------------------------------------------------------------------
// What each field's own description CLAIMS it serves
// ---------------------------------------------------------------------------------------------

/** "Not used for add", "it is NOT where you say the new days" — a mention inside a negation is a
 *  disclaimer, not a promise. Only look back as far as the last full stop. */
const NEGATED = /\b(not|never|no)\b[^.]*$/i;

/**
 * The actions a field's description names. Positive mentions win outright; a description that
 * names actions ONLY to exclude them ("Not used for add") is claiming every other action.
 */
function claimedActions(description: string): string[] {
  const positive = new Set<string>();
  const negative = new Set<string>();
  for (const action of ACTIONS) {
    const re = new RegExp(`\\b${action}\\b`, 'gi');
    for (let hit = re.exec(description); hit; hit = re.exec(description)) {
      (NEGATED.test(description.slice(0, hit.index)) ? negative : positive).add(action);
    }
  }
  if (positive.size) return [...positive];
  if (negative.size) return ACTIONS.filter((a) => !negative.has(a));
  return [];
}

const CLAIMED: Array<{ action: string; field: string }> = [];
for (const [field, spec] of Object.entries(FIELDS)) {
  for (const action of claimedActions(spec.description ?? '')) CLAIMED.push({ action, field });
}

/**
 * `on_days` names no action in its description at all, so nothing above can check WHICH actions
 * must honour it — it is held only by the "every field is read by something" test. Naming the
 * actions in its description would give it the same cover every other field has.
 */
const NAMES_NO_ACTION = new Set(['on_days']);

/**
 * Read by the code, never offered to the model.
 *
 * `duration_min`'s description still says "For resize and add" — but plan-edit.ts's `rework`
 * branch has honoured it since #233 (it was the fix for the 35-then-40 drop). The behaviour is
 * right and the promise is stale, so the coach is never told she can resize while she reworks and
 * has to spend a second edit on it. Listing it here keeps that fix pinned; the real repair is one
 * sentence in the schema, after which this entry is redundant rather than wrong.
 */
const READ_BUT_UNDECLARED: Array<{ action: string; field: string }> = [];

// ---------------------------------------------------------------------------------------------

describe('the plan-edit schema and the code that serves it', () => {
  it('has a probe for every field and a base edit for every action', () => {
    // Not busywork: without these, a new field would be "not read" for a reason this file
    // invented rather than a reason the code has, and the guard below would lie in both
    // directions. Add the field's realistic value to PROBE, then make the code honour it.
    expect({ probes: Object.keys(PROBE).sort(), bases: Object.keys(BASE).sort() }).toEqual({
      probes: [...FIELD_NAMES].sort(),
      bases: [...ACTIONS].sort(),
    });
  });

  it('describes every field, and says which actions it serves', () => {
    const mute = FIELD_NAMES.filter((f) => !FIELDS[f]?.description?.trim()).map((f) => `${f} has no description`);
    const vague = FIELD_NAMES.filter(
      (f) => !NAMES_NO_ACTION.has(f) && !claimedActions(FIELDS[f]?.description ?? '').length,
    ).map((f) => `${f} names no action, so nothing can check which actions must honour it (${HOW})`);
    expect([...mute, ...vague]).toEqual([]);
  });

  /**
   * A field no action reads is either a code bug or a schema lie, and both cost the same: the
   * model is told it can say something, says it, and the words land on the floor. `how_to` on
   * `add` was exactly this — accepted, documented, discarded.
   */
  it('reads every field it declares, on at least one action', () => {
    const unread = FIELD_NAMES.filter((field) => !ACTIONS.some((a) => READ.has(`${a}/${field}`))).map(
      (field) => `no action reads "${field}" — either wire it up or stop offering it (${HOW})`,
    );
    expect(unread).toEqual([]);
  });

  /**
   * The five-bugs test. Each field's own description states which actions honour it; this holds
   * the code to that sentence, pair by pair. `rework` + `duration_min` would have failed here the
   * day it was written if the description had said "rework" — which is why the test above insists
   * every description name its actions.
   */
  it('honours every field on every action its description claims', () => {
    const dropped = CLAIMED.filter(({ action, field }) => !READ.has(`${action}/${field}`)).map(
      ({ action, field }) => `"${action}" accepts "${field}" and does nothing with it — the schema promises it does`,
    );
    expect(dropped).toEqual([]);
  });

  /** The fix for the 35-then-40 drop, pinned — the schema does not advertise this one, so the
   *  test above cannot hold it and a refactor could quietly undo it again. */
  it('still honours the fields it reads but never advertised', () => {
    const lost = READ_BUT_UNDECLARED.filter(({ action, field }) => !READ.has(`${action}/${field}`)).map(
      ({ action, field }) => `"${action}" stopped reading "${field}" — this was a shipped fix, not an accident`,
    );
    expect(lost).toEqual([]);
  });

  /**
   * Two lists of the same six words, thirty lines apart: the enum the model is shown, and the
   * array `asEdits` filters on. Diverge them and an action the coach is TOLD she can use is
   * dropped on the way in, with no rejection and no card — she would try it, watch nothing
   * happen, and try it again.
   *
   * Read out of the source because `asEdits` is not exported. If the filter ever stops hardcoding
   * a list — reading the enum directly instead, which is the real fix — there is nothing left to
   * diverge and nothing here to check.
   */
  it('filters on exactly the actions it offers', () => {
    const source = readFileSync(new URL('./coach-actions.ts', import.meta.url), 'utf8');
    const start = source.indexOf('function asEdits(');
    expect(start, 'asEdits() is how raw tool arguments become edits — if it moved, follow it').toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('\n}', start));
    for (const literal of body.matchAll(/\[([^\]]*)\]/g)) {
      const items = [...(literal[1] ?? '').matchAll(/'([^']*)'/g)].map((q) => q[1] ?? '');
      if (!items.some((i) => ACTIONS.includes(i))) continue;
      expect([...items].sort()).toEqual([...ACTIONS].sort());
    }
  });

  /**
   * The five-bugs class, closed in the general case. `applyToOne` reads only the fields its own
   * branch needs, so a `resize` carrying `how_to`, or a `move` carrying `time_of_day`, used to
   * apply half of what was asked and report all of it as done. That is how "two of four edits in
   * one call did nothing" happened: the coach put the new days in `on_days`, the harness read
   * `days`, found none, and the person was told their week had moved.
   *
   * Now `applyPlanEdits` names every stray field in `ignored`, decided by EDIT_FIELDS_READ — the
   * one map of what each action reads, exported precisely so this test can hold it to the probe's
   * observed truth. Three ways to fail, each its own lie:
   * - a field neither read nor mentioned is the original bug — accepted and thrown away;
   * - a map row disagreeing with the probe is the map rotting into a second hand-written list;
   * - a field both read AND reported ignored means the note itself lies.
   * The addressing trio (`activities`/`activity`/`on_days`) never shows up in the notes except on
   * `add`, which targets nothing — everywhere else targeting consumes it, and the probe sees that
   * as read.
   */
  it('says something about every field it was handed and did not use', () => {
    const wrong: string[] = [];
    for (const action of ACTIONS) {
      const mapped = EDIT_FIELDS_READ[action as PlanEditAction] as readonly string[];
      for (const field of FIELD_NAMES) {
        const read = READ.has(`${action}/${field}`);
        const mentioned = applyPlanEdits(PLAN, [editFor(action, field, true)], GOAL_TITLES).ignored.some((n) =>
          n.includes(`"${field}"`),
        );
        if (!read && !mentioned) wrong.push(`"${action}" was given "${field}" and never mentioned it again`);
        if (read !== mapped.includes(field))
          wrong.push(
            `EDIT_FIELDS_READ says "${action}" ${mapped.includes(field) ? 'reads' : 'does not read'} "${field}" — the probe shows the opposite`,
          );
        if (read && mentioned) wrong.push(`"${action}" read "${field}" and still reported it as ignored`);
      }
    }
    expect(wrong).toEqual([]);
  });

  /**
   * DEFECT, not a passing property — skipped deliberately.
   *
   * `applyToOne` has no final else: after the `remove`/`move`/`rework`/`retime` branches it falls
   * through into the resize tail, so an unrecognised action IS a resize. Today `asEdits` shields
   * it by filtering the enum first, which means the whole protection against this is the two
   * lists agreeing — and the test above exists precisely because they might not. Should they ever
   * drift, `{"action": "rename", "duration_min": 30}` does not get refused; it silently changes
   * how long the session is.
   */
  it('refuses an action it does not recognise instead of treating it as a resize', () => {
    const r = applyPlanEdits(
      PLAN,
      [{ action: 'rename' as PlanEdit['action'], activities: [RUN_HANDLE], duration_min: 30 }],
      GOAL_TITLES,
    );
    expect(r.changes).toEqual([]);
    expect(r.rejected.join(' ')).toMatch(/rename/);
    expect(r.activities.find((a) => a.title === 'Easy run')?.duration_min).toBe(40);
  });
});
