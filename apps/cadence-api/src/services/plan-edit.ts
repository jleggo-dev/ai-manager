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
  /** Which commitment to change — matched loosely against its title. Not needed for `add`. */
  activity?: string;
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
  const exact = items.find((a) => a.title.trim().toLowerCase() === q);
  if (exact) return exact;
  const contains = items.filter((a) => {
    const t = a.title.trim().toLowerCase();
    return t.includes(q) || q.includes(t);
  });
  // Ambiguity is a rejection, not a coin flip: changing the wrong session is worse than asking.
  return contains.length === 1 ? (contains[0] ?? null) : null;
}

function toPending(a: Activity, goalTitle?: string): PendingPlanActivity {
  return {
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
 * Apply the edits, in order, to a copy of the current plan.
 *
 * Order matters and is honoured: "move it to Friday and cut it to 20 minutes" is two edits on the
 * same commitment and both must land. An edit naming something that isn't there — or naming it
 * ambiguously — is rejected with its reason rather than guessed at, and the rest still apply.
 */
export function applyPlanEdits(
  current: Activity[],
  edits: PlanEdit[],
  goalTitleById: Record<string, string> = {},
): PlanEditResult {
  const working = current.map((a) => toPending(a, a.goal_id ? goalTitleById[a.goal_id] : undefined));
  const changes: string[] = [];
  const rejected: string[] = [];

  for (const edit of edits) {
    if (edit.action === 'add') {
      const title = edit.title?.trim();
      if (!title) {
        rejected.push('Tried to add a commitment with no name.');
        continue;
      }
      const byday = toByDay(edit.days) ?? 'MO,WE,FR';
      const recurrence = `FREQ=WEEKLY;BYDAY=${byday}`;
      const goalId = Object.keys(goalTitleById).find((id) => goalTitleById[id] === edit.goal_title);
      working.push({
        title,
        kind: 'user',
        cadence: describeRecurrence(recurrence),
        recurrence,
        ...(edit.time_of_day ? { time_of_day: edit.time_of_day } : {}),
        ...(edit.duration_min ? { duration_min: edit.duration_min } : {}),
        completion_source: 'self_report',
        ...(goalId ? { goal_id: goalId } : {}),
        ...(edit.goal_title ? { goal_title: edit.goal_title } : {}),
        ...(edit.why ? { why: edit.why } : {}),
        suggested: true,
      });
      changes.push(`Add ${title} — ${describeRecurrence(recurrence)}`);
      continue;
    }

    const query = edit.activity?.trim();
    if (!query) {
      rejected.push(`A "${edit.action}" change didn't say which commitment it meant.`);
      continue;
    }
    const found = matchActivity(working, query);
    if (!found) {
      rejected.push(`Nothing in the plan clearly matches "${query}".`);
      continue;
    }

    if (edit.action === 'remove') {
      working.splice(working.indexOf(found), 1);
      changes.push(`Drop ${found.title}`);
      continue;
    }
    if (edit.action === 'move') {
      const byday = toByDay(edit.days);
      if (!byday) {
        rejected.push(`Couldn't tell which days to move ${found.title} to.`);
        continue;
      }
      const was = found.cadence;
      found.recurrence = withDays(found.recurrence, byday);
      found.cadence = describeRecurrence(found.recurrence);
      changes.push(`Move ${found.title}: ${was} → ${found.cadence}`);
      continue;
    }
    /**
     * Change what a commitment CONTAINS, without touching when or how often it happens.
     *
     * The gap this closes, from the chat of 2026-08-16: "let's start by changing the farmer
     * carries to dead hangs". Every other action here is structural — days, times, minutes,
     * add, drop — so the one edit the user actually asked for was the one thing the coach could
     * not do. She talked about it, offered to make it permanent, and had nowhere to put the
     * answer; the swap survived exactly as long as the conversation did.
     *
     * `how_to` is the right home because prescribe-session already reads it: writing here changes
     * every future session of this commitment, which is what "make it permanent" means. The title
     * is optional and only for when the change earns a new name ("Grip finisher — dead hangs").
     */
    if (edit.action === 'rework') {
      const how = edit.how_to?.trim();
      const newTitle = edit.title?.trim();
      if (!how && !newTitle) {
        rejected.push(`Couldn't tell what ${found.title} should become.`);
        continue;
      }
      const was = found.title;
      if (how) found.how_to = how;
      if (newTitle) found.title = newTitle;
      changes.push(
        newTitle && newTitle !== was ? `${was} → ${newTitle}${how ? `: ${how}` : ''}` : `${was}: ${how ?? 'renamed'}`,
      );
      continue;
    }
    if (edit.action === 'retime') {
      const t = edit.time_of_day?.trim();
      if (!t) {
        rejected.push(`Couldn't tell what time to give ${found.title}.`);
        continue;
      }
      const was = found.time_of_day;
      found.time_of_day = t;
      changes.push(`${found.title}: ${was ? `${was} → ${t}` : `now at ${t}`}`);
      continue;
    }
    // resize
    const mins = Number(edit.duration_min);
    if (!Number.isFinite(mins) || mins <= 0 || mins > 600) {
      rejected.push(`Couldn't tell how long ${found.title} should be.`);
      continue;
    }
    const wasMin = found.duration_min;
    found.duration_min = Math.round(mins);
    changes.push(
      `${found.title}: ${wasMin ? `${wasMin} min → ${found.duration_min} min` : `${found.duration_min} min`}`,
    );
  }

  return { activities: working, changes, rejected };
}
