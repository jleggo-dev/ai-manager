import type { Activity, Goal } from '@cadence/shared';
import { NON_PLAN_CATEGORIES } from '../repos/activities.ts';
import { expandRecurrence } from './scheduling.ts';
import type { PlanViewDay } from './plan-view.ts';

/**
 * The days behind the wall, with the rhythm drawn on them (owner, 2026-09-09: "It can show the
 * future days and a potential plan, but we have to check-in to unlock").
 *
 * A week materializes ONCE, at the commit that creates it (plan-horizon.ts), so the trail's view
 * — seven days from today — runs past the last materialized day from the second day of the week
 * on. Those days used to render as ordinary empty days ("A clear day"), which read as a plan that
 * had simply stopped. They are not empty: the rhythm is known, it just has not been written down
 * yet, because the check-in that confirms or redraws it has not happened. This projects the
 * plan's own recurrences onto them, as a PREVIEW — no rows, no ids, nothing a tap could act on —
 * so the locked day can show what it would hold.
 *
 * The boundary is the same rule the client's `trailLock.ts` uses: every day after the later of
 * the check-in date and today, unless the user deliberately built past it (`built_through`,
 * 0059). Kept in lockstep by hand; a preview on an open day would be a list of things with
 * nothing to tap, and an open day past the wall is the wall failing open.
 */
export interface PlanViewPreviewItem {
  title: string;
  time_of_day?: string;
  area?: Goal['area'];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD + 1, pure date arithmetic — the client's `trailLock.ts` idiom. */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
}

/**
 * The first day behind the wall, or null when the dates cannot say (then nothing is projected).
 * `builtThrough` pushes it out: a week the user built early is open through that date.
 */
export function previewFromDate(
  endsOn: string | undefined,
  todayIso: string,
  builtThrough: string | null | undefined,
): string | null {
  if (!endsOn || !ISO_DATE.test(endsOn) || !ISO_DATE.test(todayIso)) return null;
  const afterWeek = nextDay(todayIso > endsOn ? todayIso : endsOn);
  if (builtThrough && ISO_DATE.test(builtThrough)) {
    const afterBuilt = nextDay(builtThrough);
    return afterBuilt > afterWeek ? afterBuilt : afterWeek;
  }
  return afterWeek;
}

/**
 * Writes `preview` onto every day from `from` on that has no occurrences of its own. Mutates the
 * days in place — they are the view's own fresh objects. Off-plan, episode and menu buckets never
 * project (they are not the rhythm), and neither does anything without a recurrence.
 */
export function projectPreview(
  days: PlanViewDay[],
  activities: Activity[],
  goalById: Map<string, Pick<Goal, 'area'>>,
  anchorIso: string,
  from: string | null,
): void {
  if (!from) return;
  const targets = days.filter((d) => d.date >= from && d.occurrences.length === 0);
  if (targets.length === 0) return;
  const to = targets[targets.length - 1]!.date;
  const byDate = new Map(targets.map((d) => [d.date, [] as PlanViewPreviewItem[]]));

  for (const a of activities) {
    if (a.category && NON_PLAN_CATEGORIES.has(a.category)) continue;
    const recurrence = a.schedule?.recurrence;
    if (!recurrence) continue;
    const area = a.goal_id ? goalById.get(a.goal_id)?.area : undefined;
    for (const date of expandRecurrence(recurrence, from, to, anchorIso)) {
      byDate.get(date)?.push({
        title: a.title,
        ...(a.schedule?.time_of_day ? { time_of_day: a.schedule.time_of_day } : {}),
        ...(area ? { area } : {}),
      });
    }
  }

  for (const day of targets) {
    const items = byDate.get(day.date) ?? [];
    items.sort((x, y) => (x.time_of_day ?? '99').localeCompare(y.time_of_day ?? '99'));
    day.preview = items;
  }
}
