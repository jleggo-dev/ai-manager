import type { Activity, OccurrenceStatus } from '@cadence/shared';
import { getUser } from '../../repos/users.ts';
import { getActivePlan } from '../../repos/plans.ts';
import { listActivities, listActivitiesByIds } from '../../repos/activities.ts';
import { listOccurrences, type OccurrenceListRow } from '../../repos/occurrences.ts';
import { localDayIso } from '../plan-day.ts';
import type { RetrievalFunction } from './types.ts';

/**
 * The calendar AS WRITTEN — the dated rows the Plan tab actually draws — for the coach.
 *
 * Owner, 2026-09-15: "Shouldn't Cadence be able to see the calendar?" She could not. Her plan
 * read (`get_active_plan`, floor context on every turn) lists the RULES — each commitment with the
 * days it repeats on — and its "week shape" line is arithmetic on those rules; the only reads that
 * touched dated rows looked backward (get_consistency, get_recent_logs). So on 2026-09-14, with a
 * plan whose next week had never been written, she read "joint mobility, Mon/Wed/Fri/Sun, 6am",
 * concluded it must be on the screen, and told the owner to restart the app. The rules and the
 * calendar are two layers, and they differ for ordinary reasons too: a session moved or dropped
 * from the trail, a detour that cleared days, a row already done.
 *
 * Two doors, one renderer:
 *  - `get_active_plan` carries the next `CALENDAR_FLOOR_DAYS` as written (one compact line per
 *    day, today's rows with their status), so an empty or altered day is visible on the turn it
 *    matters without her having to know to look. Measured on the owner's 18-commitment plan:
 *    ~850 characters, ~210 tokens a turn.
 *  - `get_calendar` (tail tier, `plan` category) looks further ahead or back on request.
 *
 * A read, never a write; the rows come from the same table the trail draws (plan-view.ts).
 */
export const CALENDAR_FLOOR_DAYS = 7;
export const CALENDAR_DEFAULT_DAYS = 14;
export const CALENDAR_MAX_DAYS = 28;
/** A row's title on a calendar line. The full title is on the plan list above it; this keeps a
 *  seven-day block to a few lines — an 18-commitment plan runs ~120 characters a day. */
const TITLE_MAX = 32;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface WrittenRow {
  title: string;
  kind: Activity['kind'];
  /** A meal-log row (category `nutrition`) — folded into one count per day rather than listed. */
  meal: boolean;
  time_of_day: string | null;
  status: OccurrenceStatus;
}
export interface WrittenDay {
  date: string;
  rows: WrittenRow[];
}
export interface WrittenCalendar {
  today: string;
  from: string;
  to: string;
  days: WrittenDay[];
}

/** YYYY-MM-DD ± n, pure date arithmetic — the idiom plan-preview.ts and trailLock.ts share. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** A row's date as YYYY-MM-DD — the driver hands a `date` column back as a Date. */
export const dateOf = (d: string | Date): string =>
  d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);

type TitleRow = Pick<Activity, 'activity_id' | 'title' | 'kind' | 'category' | 'schedule'>;

/**
 * Titles for every row's activity. The active plan's own rows resolve from the list already in
 * hand; a row whose activity belongs to a superseded version (today's rows logged before a
 * mid-day commit re-pointed the plan — plan-view.ts renders those the same way) is looked up by
 * id, and only when one exists, so the ordinary turn costs no extra read.
 */
export async function titlesFor(
  userId: string,
  rows: Array<Pick<OccurrenceListRow, 'activity_id'>>,
  activities: TitleRow[],
): Promise<Map<string, TitleRow>> {
  const byId = new Map<string, TitleRow>(activities.map((a) => [a.activity_id, a]));
  const missing = [...new Set(rows.map((r) => r.activity_id).filter((id) => !byId.has(id)))];
  if (missing.length > 0) {
    for (const a of await listActivitiesByIds(userId, missing).catch(() => [])) byId.set(a.activity_id, a);
  }
  return byId;
}

/** The rows between `from` and `to` inclusive, one entry per day whether or not anything sits on
 *  it — an empty day is a fact the coach needs, not a gap in the list. */
export function shapeWrittenDays(
  rows: Array<Pick<OccurrenceListRow, 'activity_id' | 'date' | 'status'>>,
  titles: Map<string, TitleRow>,
  span: { from: string; to: string; today: string },
): WrittenCalendar {
  const byDate = new Map<string, WrittenRow[]>();
  for (let d = span.from; d <= span.to; d = addDays(d, 1)) byDate.set(d, []);
  for (const r of rows) {
    const day = byDate.get(dateOf(r.date));
    const a = titles.get(r.activity_id);
    if (!day || !a) continue;
    const t = a.schedule?.time_of_day;
    day.push({
      title: a.title,
      kind: a.kind,
      meal: a.category === 'nutrition',
      time_of_day: typeof t === 'string' && t.trim() ? t.trim() : null,
      status: r.status,
    });
  }
  const days = [...byDate.entries()].map(([date, list]) => ({
    date,
    rows: list.sort((x, y) => (x.time_of_day ?? '99').localeCompare(y.time_of_day ?? '99')),
  }));
  return { today: span.today, from: span.from, to: span.to, days };
}

export async function readWrittenCalendar(
  userId: string,
  opts: { activities: TitleRow[]; timezone: string | null | undefined; from?: string; days: number },
): Promise<WrittenCalendar> {
  const today = localDayIso(new Date(), opts.timezone);
  const from = opts.from && ISO_DATE.test(opts.from) ? opts.from : today;
  const to = addDays(from, Math.max(1, opts.days) - 1);
  const rows = await listOccurrences(userId, from, to);
  return shapeWrittenDays(rows, await titlesFor(userId, rows, opts.activities), { from, to, today });
}

/* ── Rendering ──────────────────────────────────────────────────────────────────────────────── */

const mark = (s: OccurrenceStatus): string =>
  s === 'done' ? ' ✓' : s === 'skipped' ? ' ✗' : s === 'missed' ? ' (missed)' : '';

function dayLabel(date: string, today: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const name = `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()}`;
  return date === today ? `${name} (today)` : name;
}

function shortTitle(title: string): string {
  const t = title.trim();
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1).trimEnd()}…` : t;
}

/** One line for a day: timed rows in order, meal logs folded to a count, an empty day said out loud. */
export function renderWrittenDay(day: WrittenDay, today: string): string {
  const label = dayLabel(day.date, today);
  if (day.rows.length === 0) return `  ${label}: — nothing written`;
  const parts = day.rows
    .filter((r) => !r.meal)
    .map((r) => `${r.time_of_day ?? 'any time'} ${shortTitle(r.title)}${mark(r.status)}`);
  const meals = day.rows.filter((r) => r.meal);
  if (meals.length > 0) {
    const logged = meals.filter((r) => r.status === 'done').length;
    parts.push(day.date <= today ? `meals ${logged}/${meals.length} logged` : `${meals.length} meal logs`);
  }
  return `  ${label}: ${parts.join(' · ')}`;
}

/**
 * The block. `heading` names the span in the caller's words; the legend rides once. A span with
 * NOTHING on it is said in one sentence rather than N empty lines, and it says what that means —
 * the exact fact she lacked on 2026-09-14.
 */
export function renderWrittenDays(cal: WrittenCalendar, heading: string): string {
  const total = cal.days.reduce((n, d) => n + d.rows.length, 0);
  if (total === 0) {
    return (
      `${heading}: NOTHING is written from ${dayLabel(cal.from, cal.today)} to ${dayLabel(cal.to, cal.today)} — ` +
      'no session sits on any of those days, so their plan screen shows nothing there. Say so plainly rather than assuming the sessions are on it.'
    );
  }
  const lines = cal.days.map((d) => renderWrittenDay(d, cal.today));
  return `${heading} (✓ done · ✗ skipped · otherwise still to do):\n${lines.join('\n')}`;
}

/* ── What they changed by hand ──────────────────────────────────────────────────────────────── */

/**
 * The person's own edits on the plan screen (0060, `source: 'trail'`), newest first — "Part of the
 * rule for moving things in the calendar was that Cadence would know about it (moving, deleting,
 * adding)." Rendered as facts about what changed, since the calendar block already shows where
 * things sit now; the coach's own edits are left out (she made them).
 */
export function renderPlanEdits(
  edits: Array<{
    source: string;
    action: string;
    title: string;
    from_date: string;
    to_date: string | null;
    at: string;
  }>,
  today: string,
): string {
  const theirs = edits.filter((e) => e.source === 'trail');
  if (theirs.length === 0) return '';
  const lines = theirs.map((e) => {
    const when = dayLabel(e.at.slice(0, 10), today);
    const from = dayLabel(e.from_date, today);
    const what =
      e.action === 'move'
        ? `moved "${e.title}" from ${from} to ${dayLabel(e.to_date ?? e.from_date, today)}`
        : e.action === 'copy'
          ? `copied "${e.title}" from ${from} onto ${dayLabel(e.to_date ?? e.from_date, today)}`
          : `took "${e.title}" off ${from}`;
    return `  - ${when}: ${what}`;
  });
  return `Changes they made by hand on the plan screen (last 7 days, newest first):\n${lines.join('\n')}`;
}

/* ── The tail tool ──────────────────────────────────────────────────────────────────────────── */

export const GET_CALENDAR: RetrievalFunction = {
  name: 'get_calendar',
  description:
    'The user\'s calendar as actually written, day by day: which sessions and habits sit on each date, with the time and whether each was done, skipped or is still to do. Use when a specific date matters — what is on next Tuesday, why a day looks empty, what they did on a past day. The plan read already shows the next 7 days this way; use this to look further ahead or back. Pass {"days": 14} for that many days from today (default 14, up to 28), or {"from": "2026-10-01", "days": 7} to start on a date.',
  domains: ['plans', 'occurrences'],
  async run(userId, params) {
    const [user, plan] = await Promise.all([getUser(userId), getActivePlan(userId)]);
    if (!plan) return { plan: null };
    const asked = Math.trunc(Number(params?.days ?? CALENDAR_DEFAULT_DAYS));
    const days = Math.min(CALENDAR_MAX_DAYS, Math.max(1, Number.isFinite(asked) ? asked : CALENDAR_DEFAULT_DAYS));
    const from = typeof params?.from === 'string' ? params.from.trim() : undefined;
    const activities = await listActivities(plan.plan_id);
    const calendar = await readWrittenCalendar(userId, { activities, timezone: user?.timezone, from, days });
    return { plan: { version: plan.version }, calendar };
  },
  render(r) {
    const { plan, calendar } = r as { plan: { version: number } | null; calendar?: WrittenCalendar };
    if (!plan || !calendar) {
      return 'They have no active plan, so there is no calendar to read — offer to build one (the build card).';
    }
    return renderWrittenDays(calendar, `Their calendar as written, ${calendar.from} to ${calendar.to}`);
  },
  rows(r) {
    const cal = (r as { calendar?: WrittenCalendar }).calendar;
    return cal ? cal.days.reduce((n, d) => n + d.rows.length, 0) : 0;
  },
};
