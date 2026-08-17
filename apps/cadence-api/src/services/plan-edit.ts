import type { Activity, PendingPlanActivity } from '@cadence/shared';
import { describeRecurrence, parseRecurrence } from './scheduling.ts';

/**
 * Applying a NAMED change to an existing plan — deterministically, in code.
 *
 * The coach could already rebuild a week (the build card runs synthesis over everything known),
 * and that is the right tool for "my life changed". It is the wrong tool for "move Thursday's run
 * to Friday": a full re-synthesis can quietly restructure six other things nobody asked about,
 * costs a minute, and cannot promise that the one requested edit is the only edit. Observed on
 * device 2026-08-14 — the coach agreed a small change, put up the rebuild card, the user dismissed
 * it, and from then on she could discuss the plan and do nothing to it.
 *
 * So: the model chooses WHICH activity and WHAT to do to it; this file does the doing. No LLM in
 * the edit path means the diff shown to the user is exactly what commits, and a change nobody
 * asked for is impossible rather than unlikely.
 *
 * Nothing here writes anything. It returns the would-be plan plus a human diff; storing that as
 * the pending plan (and committing it only on a tap) is the caller's job — see coach-actions.ts.
 */

/** Day names the model may use, mapped to RRULE's own vocabulary. */
const DAY_CODES: Record<string, string> = {
  monday: 'MO',
  tuesday: 'TU',
  wednesday: 'WE',
  thursday: 'TH',
  friday: 'FR',
  saturday: 'SA',
  sunday: 'SU',
  mon: 'MO',
  tue: 'TU',
  tues: 'TU',
  wed: 'WE',
  thu: 'TH',
  thur: 'TH',
  thurs: 'TH',
  fri: 'FR',
  sat: 'SA',
  sun: 'SU',
  mo: 'MO',
  tu: 'TU',
  we: 'WE',
  th: 'TH',
  fr: 'FR',
  sa: 'SA',
  su: 'SU',
};

export type PlanEditAction = 'move' | 'retime' | 'resize' | 'remove' | 'add' | 'rework';

export interface PlanEdit {
  action: PlanEditAction;
  /**
   * WHICH commitments, by the handles `get_active_plan` prints beside them. The primary way to
   * address anything: exact, order-independent, and plural — one edit can carry every run in the
   * week. An unknown handle rejects the edit; it never falls back to matching the title.
   */
  activities?: string[];
  /**
   * Legacy address: the title. Kept for a coach working from the plan as prose rather than from
   * `get_active_plan`, and deliberately strict — exact-and-unique, or narrowed by `on_days`, or
   * refused. Prefer `activities`.
   */
  activity?: string;
  /**
   * Which one, when the title alone is ambiguous: the days it happens on NOW. "The Wednesday
   * easy run" is `activity: "Easy run", on_days: ["wednesday"]`. Without this there was no way
   * to name one of two same-titled commitments at all (2026-08-17).
   */
  on_days?: string[];
  /** `move`: the days it should happen on, e.g. ["friday"] or ["mon","wed"]. */
  days?: string[];
  /** `retime`: "07:00", or a word the plan already uses ("morning"). */
  time_of_day?: string;
  /** `resize`: minutes per session. */
  duration_min?: number;
  /** `add`: what the new commitment is called. `rework`: a new name for it, if the change earns one. */
  title?: string;
  /**
   * `rework`: what the session should CONTAIN from now on, in plain words — "dead hangs instead
   * of farmers carries for the grip work". Fed to prescribe-session, so it changes every future
   * session of this commitment, not just the next one.
   */
  how_to?: string;
  /** `add`: how often, in the same day vocabulary as `move`. Defaults to weekly on one day. */
  goal_title?: string;
  why?: string;
}

export interface PlanEditResult {
  activities: PendingPlanActivity[];
  /**
   * Edits that asked for the state the plan is ALREADY in. Not changes and not failures — they
   * must never reach the card, and she must be told so she can say "that's already how it is"
   * instead of announcing a fix that fixes nothing.
   */
  noops: string[];
  /** One plain line per change, in the user's terms — what the card renders and the coach says. */
  changes: string[];
  /** Edits that could not be applied, each explaining itself. */
  rejected: string[];
}

/** RRULE byday list from loose day words. Returns null when nothing parsed. */
function toByDay(days: string[] | undefined): string | null {
  if (!days?.length) return null;
  const codes = days
    .map((d) => DAY_CODES[d.trim().toLowerCase()])
    .filter((c): c is string => !!c)
    .filter((c, i, a) => a.indexOf(c) === i);
  return codes.length ? codes.join(',') : null;
}

/** Preserve interval/freq while swapping which days it lands on. */
function withDays(recurrence: string, byday: string): string {
  const { interval } = parseRecurrence(recurrence);
  const every = interval > 1 ? `;INTERVAL=${interval}` : '';
  return `FREQ=WEEKLY${every};BYDAY=${byday}`;
}

/**
 * Find the commitment the model means. Titles come back to it verbatim from `get_active_plan`, so
 * an exact match is the common case; containment either way covers "the run" for "Easy run" and
 * a model that quotes the title with its own words around it.
 */
export function matchActivity<T extends { title: string }>(items: T[], query: string): T | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  /**
   * Ambiguity is a rejection, not a coin flip — on the EXACT branch too. This used to be
   * `items.find(...)`, first match wins, and on 2026-08-17 that silently chose between two
   * commitments both titled "Easy run" (Tuesday's, renamed by one edit; Wednesday's, added by the
   * next) and moved the wrong one. The model's arguments never said Tuesday — the pick happened
   * here, invisibly. Five identical retries, each trying to say "the Wednesday one" through
   * fields the move path never reads, could not steer it: there was nothing to steer.
   */
  const exact = items.filter((a) => a.title.trim().toLowerCase() === q);
  if (exact.length) return exact.length === 1 ? (exact[0] ?? null) : null;
  const contains = items.filter((a) => {
    const t = a.title.trim().toLowerCase();
    return t.includes(q) || q.includes(t);
  });
  return contains.length === 1 ? (contains[0] ?? null) : null;
}

/**
 * The disambiguator `matchActivity` refuses to guess at: "the Wednesday one", said in schema.
 * Filters to commitments whose CURRENT days include every day named, then matches by title within
 * that. Falls back to the plain title match when no days are given.
 */
export function matchActivityOnDays<T extends { title: string; recurrence: string }>(
  items: T[],
  query: string,
  onDays: string[] | undefined,
): T | null {
  const byday = toByDay(onDays);
  if (!byday) return matchActivity(items, query);
  const wanted = byday.split(',');
  const scoped = items.filter((a) => {
    const r = (a.recurrence || '').toUpperCase();
    // A daily commitment happens on every day named; a weekly one on its BYDAY list.
    if (r.includes('FREQ=DAILY')) return true;
    const has = new Set(r.match(/BYDAY=([A-Z,]+)/)?.[1]?.split(',') ?? []);
    return wanted.every((d) => has.has(d));
  });
  return matchActivity(scoped, query);
}

function toPending(a: Activity, goalTitle?: string): PendingPlanActivity {
  return {
    // The lineage rides through the proposal so committing it CHANGES this commitment rather than
    // replacing it with a look-alike that has no history (0036).
    commitment_id: a.commitment_id,
    title: a.title,
    kind: a.kind,
    ...(a.category ? { category: a.category } : {}),
    cadence: describeRecurrence(a.schedule.recurrence),
    recurrence: a.schedule.recurrence,
    ...(a.schedule.time_of_day ? { time_of_day: a.schedule.time_of_day } : {}),
    ...(a.schedule.duration_min ? { duration_min: a.schedule.duration_min } : {}),
    ...(a.target ? { target: a.target } : {}),
    completion_source: a.completion_source,
    ...(a.goal_id ? { goal_id: a.goal_id } : {}),
    ...(goalTitle ? { goal_title: goalTitle } : {}),
    ...(a.why ? { why: a.why } : {}),
    ...(a.how_to ? { how_to: a.how_to } : {}),
    ...(a.suggested ? { suggested: a.suggested } : {}),
  };
}

/**
 * The handle a commitment is addressed BY — short, opaque, and printed beside it in
 * `get_active_plan` so the coach never has to describe which one she means in prose.
 *
 * Eight hex characters, not the whole uuid: sixteen commitments' worth of full uuids is a few
 * hundred tokens on every turn that reads the plan, and models drop hex digits from long strings.
 * Eight is collision-free at plan scale and short enough to copy exactly.
 *
 * Derived from `commitment_id`, NOT `activity_id` (0036). Activity rows are replaced wholesale on
 * every Apply, so a handle built from one was dead the moment the user tapped; the commitment is
 * the thing they actually have, and it survives. A handle read three versions ago still names the
 * right commitment today.
 */
export const activityHandle = (commitmentId: string): string => commitmentId.replace(/-/g, '').slice(0, 8);

/** How a rejected edit shows the coach what she COULD have addressed. */
function handleList(working: PendingPlanActivity[], handles: Map<PendingPlanActivity, string>): string {
  return working.map((a) => `${handles.get(a) ?? '?'} (${a.title})`).join(', ');
}

/**
 * Which commitments an edit is aimed at.
 *
 * Handles first and exactly: an unknown one is a rejection listing the real ones, never a
 * fallback to guessing at the title. `activity` remains for a coach working from a plan she was
 * handed as prose rather than from `get_active_plan`, and it is strict — exact-and-unique, or
 * disambiguated by `on_days`, or refused (2026-08-17: first-match-wins moved the wrong run).
 */
function resolveTargets(
  edit: PlanEdit,
  working: PendingPlanActivity[],
  handles: Map<PendingPlanActivity, string>,
): { targets: PendingPlanActivity[]; reject?: string } {
  const asked = (edit.activities ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (asked.length) {
    const byHandle = new Map([...handles].map(([a, h]) => [h, a]));
    const targets: PendingPlanActivity[] = [];
    const unknown: string[] = [];
    for (const h of asked) {
      const hit = byHandle.get(h);
      if (!hit) unknown.push(h);
      else if (!targets.includes(hit)) targets.push(hit);
    }
    if (unknown.length) {
      return {
        targets: [],
        reject: `No commitment has the handle ${unknown.map((h) => `"${h}"`).join(', ')} — nothing was changed. The plan's handles are: ${handleList(working, handles)}. If the plan has changed since you read it, call get_active_plan again.`,
      };
    }
    return { targets };
  }

  const query = edit.activity?.trim();
  if (!query) return { targets: [], reject: `A "${edit.action}" change didn't say which commitment it meant.` };

  const found = matchActivityOnDays(working, query, edit.on_days);
  if (found) return { targets: [found] };

  const twins = working.filter((a) => a.title.trim().toLowerCase() === query.toLowerCase());
  return {
    targets: [],
    reject:
      twins.length > 1 && !edit.on_days?.length
        ? `${twins.length} commitments are called "${query}" (${twins.map((a) => `${handles.get(a) ?? '?'} — ${describeRecurrence(a.recurrence)}`).join(' / ')}) — address the one you mean by its handle.`
        : `Nothing in the plan clearly matches "${query}"${edit.on_days?.length ? ` on ${edit.on_days.join(', ')}` : ''}. The plan's handles are: ${handleList(working, handles)}.`,
  };
}

/**
 * "No particular time" as a CHOICE rather than an omission.
 *
 * Owner: *"we could make time_of_day not optional — she can then specifically provide a value of
 * 'any time'… but she could deliberately pick to have no time specified, and that it is a
 * deliberate decision."* Exactly the distinction that was missing: a blank meant both "this
 * floats" and "she forgot", and on 2026-08-17 it meant the second — she supplied a time on one
 * add and dropped it on a redo 29 seconds later, and nothing anywhere could tell which had
 * happened.
 *
 * Stored as the literal `anytime`, which sorts after every clock time in plan-view's ordering, so
 * a floating commitment still settles to the bottom of its day exactly as an untimed one did.
 */
export const ANYTIME = 'anytime';
const ANYTIME_WORDS = new Set(['anytime', 'any time', 'any', 'whenever', 'flexible', 'no time', 'none']);

/** Read a time the model wrote, collapsing every way it might say "no particular time". */
function normalizeTimeOfDay(raw: string | undefined): string | undefined {
  const t = raw?.trim();
  if (!t) return undefined;
  return ANYTIME_WORDS.has(t.toLowerCase()) ? ANYTIME : t;
}

/** How a time reads on the card. */
const showTime = (t: string) => (t === ANYTIME ? 'any time' : t);

/** `add` — the one action with no existing target. */
function applyAdd(
  edit: PlanEdit,
  working: PendingPlanActivity[],
  goalTitleById: Record<string, string>,
): { change?: string; reject?: string; added?: PendingPlanActivity } {
  const title = edit.title?.trim();
  if (!title) return { reject: 'Tried to add a commitment with no name.' };
  /**
   * Two commitments must never share a name. Even with handles carrying the addressing, a plan
   * showing the same title twice is unreadable to the PERSON — and it is how the 2026-08-17 pair
   * was born: one card renamed Tuesday's run "Easy run" and added a Wednesday "Easy run" beside it.
   */
  if (working.some((a) => a.title.trim().toLowerCase() === title.toLowerCase())) {
    return {
      reject: `"${title}" already names a commitment — two by the same name are indistinguishable to the user reading their own week. Pick a distinct name ("${title} (Wednesday)", "${title} — hills").`,
    };
  }
  /**
   * A new commitment must say WHEN, even if the answer is "no particular time". Not a default —
   * a default is the omission wearing a nicer name, and the owner asked for a decision.
   */
  const when = normalizeTimeOfDay(edit.time_of_day);
  if (!when) {
    return {
      reject: `"${title}" was not added: it needs a time of day. Set one — the time their other sessions of that kind run at, or ask them — or pass time_of_day "anytime" if it genuinely floats.`,
    };
  }
  const byday = toByDay(edit.days) ?? 'MO,WE,FR';
  const recurrence = `FREQ=WEEKLY;BYDAY=${byday}`;
  const goalId = Object.keys(goalTitleById).find((id) => goalTitleById[id] === edit.goal_title);
  const added: PendingPlanActivity = {
    title,
    kind: 'user',
    cadence: describeRecurrence(recurrence),
    recurrence,
    time_of_day: when,
    ...(edit.duration_min ? { duration_min: edit.duration_min } : {}),
    completion_source: 'self_report',
    ...(goalId ? { goal_id: goalId } : {}),
    ...(edit.goal_title ? { goal_title: edit.goal_title } : {}),
    ...(edit.how_to ? { how_to: edit.how_to } : {}),
    ...(edit.why ? { why: edit.why } : {}),
    suggested: true,
  };
  /**
   * An untimed commitment sorts to the bottom of its day (plan-view.ts) and anchors no reminder,
   * so silence here is a real gap the user only discovers later. She omitted it on one add and
   * supplied it on another a minute earlier, so the model is inconsistent rather than wrong —
   * naming it on the card is what lets either of them notice.
   */
  return { added, change: `Add ${title} — ${describeRecurrence(recurrence)}, ${showTime(when)}` };
}

/** Everything that changes an existing commitment, one target at a time. */
function applyToOne(
  edit: PlanEdit,
  found: PendingPlanActivity,
  working: PendingPlanActivity[],
): { change?: string; reject?: string; noop?: string } {
  if (edit.action === 'remove') {
    working.splice(working.indexOf(found), 1);
    return { change: `Drop ${found.title}` };
  }

  if (edit.action === 'move') {
    const byday = toByDay(edit.days);
    if (!byday) return { reject: `Couldn't tell which days to move ${found.title} to.` };
    const was = found.cadence;
    const next = withDays(found.recurrence, byday);
    if (next === found.recurrence) return { noop: `${found.title} is already on ${was}.` };
    found.recurrence = next;
    found.cadence = describeRecurrence(found.recurrence);
    return { change: `Move ${found.title}: ${was} → ${found.cadence}` };
  }

  /**
   * Change what a commitment CONTAINS, without touching when or how often it happens.
   *
   * The gap this closes, from the chat of 2026-08-16: "let's start by changing the farmer carries
   * to dead hangs". Every other action here is structural — days, times, minutes, add, drop — so
   * the one edit the user actually asked for was the one thing the coach could not do. `how_to` is
   * the right home because prescribe-session already reads it: writing here changes every future
   * session of this commitment, which is what "make it permanent" means.
   */
  if (edit.action === 'rework') {
    const how = edit.how_to?.trim();
    const newTitle = edit.title?.trim();
    if (!how && !newTitle) return { reject: `Couldn't tell what ${found.title} should become.` };
    if (newTitle && working.some((a) => a !== found && a.title.trim().toLowerCase() === newTitle.toLowerCase())) {
      return {
        reject: `"${newTitle}" already names a commitment — renaming ${found.title} to match it would leave the user reading two identical rows. Pick a distinct name.`,
      };
    }
    const was = found.title;
    if (how) found.how_to = how;
    if (newTitle) found.title = newTitle;
    /**
     * A rework that says how long it should now take gets that too. The schema always accepted
     * `duration_min` and this branch silently dropped it — the coach passed 35, then 40, in two
     * successive proposals on 2026-08-17, both discarded without a word, and the "35-40 minute
     * easy run" she described to the user stayed 60 minutes in the plan.
     */
    const mins = Number(edit.duration_min);
    const resized = Number.isFinite(mins) && mins > 0 && mins <= 600;
    const wasMins = found.duration_min;
    if (resized) found.duration_min = Math.round(mins);
    const note = resized && wasMins !== found.duration_min ? ` (${wasMins ?? '?'} → ${found.duration_min} min)` : '';
    return {
      change:
        newTitle && newTitle !== was
          ? `${was} → ${newTitle}${how ? `: ${how}` : ''}${note}`
          : `${was}: ${how ?? 'renamed'}${note}`,
    };
  }

  if (edit.action === 'retime') {
    const t = normalizeTimeOfDay(edit.time_of_day);
    if (!t) return { reject: `Couldn't tell what time to give ${found.title}.` };
    const was = found.time_of_day;
    if (was === t) return { noop: `${found.title} is already at ${showTime(t)}.` };
    found.time_of_day = t;
    return {
      change: `${found.title}: ${was ? `${showTime(was)} → ${showTime(t)}` : `now at ${showTime(t)}`}`,
    };
  }

  const mins = Number(edit.duration_min);
  if (!Number.isFinite(mins) || mins <= 0 || mins > 600) {
    return { reject: `Couldn't tell how long ${found.title} should be.` };
  }
  const wasMin = found.duration_min;
  const next = Math.round(mins);
  /**
   * "40 min → 40 min" is not a change, and rendering it as one is how the owner came to tap Apply
   * on a card that did nothing (2026-08-17). Plan v10 committed byte-identical to v9 across all 16
   * activities, its stored rationale literally "Easy run: 40 min → 40 min" twice, and the apply
   * still wiped and regenerated ten prescribed sessions. From where he sat she had promised a fix,
   * shown a card, and delivered nothing — which is indistinguishable from the tool being broken.
   */
  if (wasMin === next) return { noop: `${found.title} is already ${next} min.` };
  found.duration_min = next;
  return {
    change: `${found.title}: ${wasMin ? `${wasMin} min → ${next} min` : `${next} min`}`,
  };
}

/**
 * Apply the edits, in order, to a copy of the current plan.
 *
 * Order matters and is honoured: "move it to Friday and cut it to 20 minutes" is two edits on the
 * same commitment and both must land. An edit naming something that isn't there — or naming it
 * ambiguously — is rejected with its reason rather than guessed at, and the rest still apply.
 *
 * An edit may carry SEVERAL handles, which is how "make all my runs 45 minutes" is one edit rather
 * than three the coach has to enumerate and get individually right. Each target produces its own
 * line on the card, so a plural edit is still exactly as auditable as a singular one.
 */
export function applyPlanEdits(
  current: Activity[],
  edits: PlanEdit[],
  goalTitleById: Record<string, string> = {},
): PlanEditResult {
  const handles = new Map<PendingPlanActivity, string>();
  const working = current.map((a) => {
    const pending = toPending(a, a.goal_id ? goalTitleById[a.goal_id] : undefined);
    handles.set(pending, activityHandle(a.commitment_id));
    return pending;
  });
  const changes: string[] = [];
  const rejected: string[] = [];
  const noops: string[] = [];
  let addedSeq = 0;

  for (const edit of edits) {
    if (edit.action === 'add') {
      const { change, reject, added } = applyAdd(edit, working, goalTitleById);
      if (reject) rejected.push(reject);
      if (added) {
        working.push(added);
        // Addressable within the same batch: "add it, then make it 30 minutes" is two edits.
        handles.set(added, `new${++addedSeq}`);
      }
      if (change) changes.push(change);
      continue;
    }

    const { targets, reject } = resolveTargets(edit, working, handles);
    if (reject) {
      rejected.push(reject);
      continue;
    }
    for (const found of targets) {
      const r = applyToOne(edit, found, working);
      if (r.reject) rejected.push(r.reject);
      if (r.noop) noops.push(r.noop);
      if (r.change) changes.push(r.change);
    }
  }

  return { activities: working, changes, rejected, noops };
}
