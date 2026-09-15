import { getUser } from '../repos/users.ts';
import { getActivePlan } from '../repos/plans.ts';
import { listActivities } from '../repos/activities.ts';
import { listOccurrences } from '../repos/occurrences.ts';
import type { CoachActionTool } from './coach-action-types.ts';
import { duplicateOccurrence, moveOccurrence, removeOccurrence, type OccurrenceEditResult } from './occurrence-edit.ts';
import { titlesFor } from './retrieval/calendar-function.ts';

/**
 * `edit_calendar` — the trail's hold menu, from chat (owner, 2026-09-15: "she should be able to
 * adjust the calendar and the plan").
 *
 * The plan has two layers. `propose_plan_change` edits the RULES — a commitment's days, time,
 * length, contents — through a card the person taps, because a rule change touches every week
 * from now on. This edits the CALENDAR: one dated session, moved to another day this week, copied
 * onto one, or taken off — exactly what holding a task on the plan screen offers, and applied
 * the same way that is: at once. It is one fact the person can check in the sentence she says
 * back ("moved Thursday's hill intervals to Friday"), the shape the always-on writes already take
 * effect on. The same service the hold menu uses does the work (occurrence-edit.ts), so the
 * week-window rule and the same-day conflict rule hold whichever door the edit came through, and
 * the edit is recorded (0060) with `source: 'coach'` beside the person's own.
 *
 * A session is named by its date and title as the calendar read shows them, never by an id the
 * model would have to carry. Tail tier, `plan` category, with a DRAWER_HOOKS line.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACTIONS = ['move', 'copy', 'delete'] as const;
type Action = (typeof ACTIONS)[number];

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

function refused(reason: string): string {
  return `Nothing was changed on their calendar: ${reason}`;
}

/** The session on `date` the title names — exact first, then a title that starts with or
 *  contains the words; one match or nothing. Two matches are handed back to be named apart. */
function pick<T extends { title: string }>(rows: T[], title: string): { row?: T; several?: T[] } {
  const want = norm(title);
  const exact = rows.filter((r) => norm(r.title) === want);
  if (exact.length === 1) return { row: exact[0] };
  if (exact.length > 1) return { several: exact };
  const loose = rows.filter((r) => norm(r.title).startsWith(want) || norm(r.title).includes(want));
  if (loose.length === 1) return { row: loose[0] };
  if (loose.length > 1) return { several: loose };
  return {};
}

function said(action: Action, title: string, date: string, to: string | undefined, r: OccurrenceEditResult): string {
  switch (r.status) {
    case 'ok':
      if (action === 'move')
        return `Done — "${title}" moved from ${date} to ${to}. Their plan screen shows it there now; say so in one line.`;
      if (action === 'copy')
        return `Done — a copy of "${title}" now sits on ${to}, still to do; the ${date} one stays. Say so in one line.`;
      return `Done — "${title}" is off ${date}. The commitment itself is unchanged and still repeats as planned; say so in one line.`;
    case 'out_of_range':
      return refused(
        `${to} is outside this week (${r.from} to ${r.to}), and a session can only be moved or copied within it. A change past this week is a plan change — propose_plan_change.`,
      );
    case 'conflict':
      return refused(`"${title}" already sits on ${to} (${r.existing_status}). One session per day per commitment.`);
    case 'not_found':
      return refused(`that session could not be found on ${date} any more — read get_active_plan and try again.`);
  }
}

export const EDIT_CALENDAR: CoachActionTool = {
  name: 'edit_calendar',
  description:
    'Move, copy or delete ONE dated session on their calendar, this week only — what holding a task on their plan screen does. Takes effect immediately; say what changed in one line. Use it for a one-off ("move tomorrow\'s hill intervals to Thursday", "take Friday\'s run off", "put a second sit on Sunday"); for a change to EVERY week from now on, use propose_plan_change instead. Name the session by its date and title as the calendar shows them: {"action": "move", "date": "2026-09-15", "title": "Hill intervals", "to": "2026-09-17"}. "copy" needs "to" as well; "delete" needs only "date" and "title". A day outside this week, or one that already holds that session, is refused with the reason.',
  parameters: {
    properties: {
      action: {
        type: 'string',
        enum: [...ACTIONS],
        description: '"move" it to another day, "copy" it onto one, or "delete" it.',
      },
      date: { type: 'string', description: 'The day the session sits on now, as YYYY-MM-DD.' },
      title: {
        type: 'string',
        description:
          'The session\'s title as the calendar shows it, e.g. "Hill intervals". A distinct start of the title is enough.',
      },
      to: { type: 'string', description: 'For move and copy: the day it goes to, as YYYY-MM-DD, within this week.' },
    },
    required: ['action', 'date', 'title'],
  },
  async run(userId, params) {
    const action = String(params.action ?? '').trim() as Action;
    const date = String(params.date ?? '').trim();
    const title = String(params.title ?? '').trim();
    const to = typeof params.to === 'string' && params.to.trim() ? params.to.trim() : undefined;

    if (!ACTIONS.includes(action)) return refused(`"${action}" is not one of move, copy, delete.`);
    if (!ISO_DATE.test(date)) return refused(`"${date}" is not a day in YYYY-MM-DD form.`);
    if (!title) return refused('no session title was given.');
    if (action !== 'delete' && !(to && ISO_DATE.test(to))) {
      return refused(`a ${action} needs "to", the day it goes to, in YYYY-MM-DD form.`);
    }

    const [user, plan] = await Promise.all([getUser(userId), getActivePlan(userId)]);
    if (!plan)
      return refused(
        'they have no active plan, so there is no calendar to edit — offer to build one (the build card).',
      );

    const rows = await listOccurrences(userId, date, date);
    const titles = await titlesFor(userId, rows, await listActivities(plan.plan_id));
    const onDay = rows.flatMap((r) => {
      const a = titles.get(r.activity_id);
      return a ? [{ occurrence_id: r.occurrence_id, title: a.title }] : [];
    });
    const found = pick(onDay, title);
    if (found.several) {
      return refused(
        `${found.several.length} sessions on ${date} match "${title}": ${found.several.map((s) => `"${s.title}"`).join(', ')}. Name one exactly.`,
      );
    }
    if (!found.row) {
      const holds = onDay.length
        ? `That day holds: ${onDay.map((s) => `"${s.title}"`).join(', ')}.`
        : 'Nothing at all is written on that day.';
      return refused(`nothing called "${title}" sits on ${date}. ${holds}`);
    }

    const tz = user?.timezone ?? null;
    const id = found.row.occurrence_id;
    const result: OccurrenceEditResult =
      action === 'move'
        ? await moveOccurrence(userId, id, to!, tz, 'coach')
        : action === 'copy'
          ? await duplicateOccurrence(userId, id, to!, tz, 'coach')
          : (await removeOccurrence(userId, id, 'coach')) === 'ok'
            ? { status: 'ok', occurrence_id: id }
            : { status: 'not_found' };
    return said(action, found.row.title, date, to, result);
  },
};
