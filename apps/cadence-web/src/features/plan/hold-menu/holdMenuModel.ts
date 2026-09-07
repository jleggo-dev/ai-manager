import { isFoodTitle } from '../../../components/occurrence-mod.ts';
import type { PlanActivity, PlanDay, PlanOccurrence } from '../../../lib/api.ts';

/**
 * The hold menu's rules (owner, 2026-09-07), in one pure place so the sheet has nothing to decide:
 *
 *   • Tapping a task on today or in the past opens it as ever. A FUTURE tap opens a preview.
 *   • Holding any task opens the menu: do it now · move · copy · take it off the plan.
 *   • "Do it now" is offered on anything not yet done, in this week (today included). A done row
 *     loses it; a skipped one keeps it — skipped is not finished.
 *   • "Do it now" on a future task MOVES it to today (never copies), after asking. A task that
 *     comes round every day — a meal — asks once more, because moving tomorrow's leaves tomorrow
 *     without one and today already has its own.
 *
 * Every function here is a deterministic router, and the table test beside this file is what
 * keeps the wrong door from opening silently (CLAUDE.md: every button gets a table test).
 */
export type DayRelation = 'past' | 'today' | 'future';

export function dayRelation(date: string, todayIso: string): DayRelation {
  return date < todayIso ? 'past' : date > todayIso ? 'future' : 'today';
}

export type HoldAction = 'do_now' | 'move' | 'duplicate' | 'delete';

/** Which rows the menu offers this task. `weekDates` is this week — today through the horizon. */
export function holdActions(
  occ: Pick<PlanOccurrence, 'status'>,
  date: string,
  weekDates: readonly string[],
): HoldAction[] {
  const actions: HoldAction[] = [];
  if (occ.status !== 'done' && occ.status !== 'paused' && weekDates.includes(date)) actions.push('do_now');
  actions.push('move', 'duplicate', 'delete');
  return actions;
}

/** An RRULE that comes round every single day: FREQ=DAILY with no interval, or an interval of 1. */
export function isEveryDay(recurrence: string | null | undefined): boolean {
  const r = (recurrence ?? '').toUpperCase();
  if (!r.includes('FREQ=DAILY')) return false;
  const m = r.match(/INTERVAL=(\d+)/);
  return !m || m[1] === '1';
}

/**
 * Does this task come round every day? The activity's own rule decides when the plan carries it;
 * the per-meal system rows ("Log breakfast") are daily by construction even when it does not.
 */
export function isEveryDayTask(
  occ: Pick<PlanOccurrence, 'activity_id' | 'title' | 'kind'>,
  activities: readonly Pick<PlanActivity, 'activity_id' | 'recurrence'>[],
): boolean {
  const a = activities.find((x) => x.activity_id === occ.activity_id);
  if (a && isEveryDay(a.recurrence)) return true;
  return occ.kind === 'system' && isFoodTitle(occ.title);
}

/** "Today", "Tomorrow", else "Wed 9" — from the week when the day is in it, from the date otherwise. */
export function dayName(date: string, week: readonly PlanDay[], todayIso: string): string {
  if (date === todayIso) return 'Today';
  const known = week.find((d) => d.date === date);
  const t = Date.parse(`${date}T12:00:00Z`);
  const tomorrow = Number.isFinite(Date.parse(`${todayIso}T12:00:00Z`))
    ? new Date(Date.parse(`${todayIso}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    : '';
  if (date === tomorrow) return 'Tomorrow';
  if (known) return `${known.weekday.slice(0, 3)} ${known.dayNum}`;
  if (!Number.isFinite(t)) return date;
  const d = new Date(t);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]!;
  return `${wd} ${d.getUTCDate()}`;
}

export interface DayChoice {
  date: string;
  label: string;
  /** This activity already sits on that day — its own day included. One per day is the rule
   *  (the server's unique index says the same), so the row is shown but cannot be picked. */
  taken: boolean;
}

/** The days a move or a copy may land on: this week, in order, with the taken ones marked. */
export function dayChoices(
  week: readonly PlanDay[],
  occ: Pick<PlanOccurrence, 'activity_id'>,
  todayIso: string,
): DayChoice[] {
  return week.map((d) => ({
    date: d.date,
    label: dayName(d.date, week, todayIso),
    taken: d.occurrences.some((o) => o.activity_id === occ.activity_id),
  }));
}

export type DoNowStep =
  /** On today (or a day already gone): nothing to move — open it. */
  | { kind: 'open' }
  /** In the future: ask first. `twin` is today's own row for the same task, if there is one — the
   *  row to open instead of moving, since a day holds a task once. */
  | { kind: 'ask_move'; everyDay: boolean; twin: Pick<PlanOccurrence, 'occurrence_id' | 'status'> | null };

export function doNowStep(
  occ: Pick<PlanOccurrence, 'activity_id' | 'title' | 'kind'>,
  date: string,
  todayIso: string,
  week: readonly PlanDay[],
  activities: readonly Pick<PlanActivity, 'activity_id' | 'recurrence'>[],
): DoNowStep {
  if (dayRelation(date, todayIso) !== 'future') return { kind: 'open' };
  const today = week.find((d) => d.date === todayIso);
  const twin = today?.occurrences.find((o) => o.activity_id === occ.activity_id) ?? null;
  return {
    kind: 'ask_move',
    everyDay: isEveryDayTask(occ, activities),
    twin: twin ? { occurrence_id: twin.occurrence_id, status: twin.status } : null,
  };
}
