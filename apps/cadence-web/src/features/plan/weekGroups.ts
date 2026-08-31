import { weekdaysFromRrule, type PendingPlanActivity } from '@cadence/shared';
import { glyphOf } from '../today/glyphs.ts';
import type { Category } from '../today/category.ts';

/** One day-section of the proposed week — see ProposedWeek.tsx for the surface that draws it. */
export type WeekGroup = {
  label: string;
  kind: 'daily' | 'day' | 'floating';
  minutes: number;
  rows: PendingPlanActivity[];
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Within a day: body first, then food, then mind, closing the day with reflection and practice. */
const FAMILY_ORDER: Record<Category, number> = { movement: 0, nutrition: 1, mindset: 2, reflection: 3, practice: 4 };

/**
 * Every day → each weekday it appears on → a floating group for anything whose recurrence the
 * parser honestly can't place (weekdaysFromRrule returns [] rather than guessing) — those rows
 * keep their humanized cadence string so nothing silently vanishes from the preview.
 */
export function groupWeek(activities: PendingPlanActivity[]): WeekGroup[] {
  const daily: PendingPlanActivity[] = [];
  const floating: PendingPlanActivity[] = [];
  const byDay: PendingPlanActivity[][] = [[], [], [], [], [], [], []];
  for (const a of activities) {
    const days = weekdaysFromRrule(a.recurrence);
    if (days.length === 7) daily.push(a);
    else if (days.length === 0) floating.push(a);
    else for (const d of days) byDay[d - 1]!.push(a);
  }
  const sortRows = (rows: PendingPlanActivity[]) =>
    [...rows].sort((x, y) => FAMILY_ORDER[glyphOf(x.title).cat] - FAMILY_ORDER[glyphOf(y.title).cat]);
  const groups: WeekGroup[] = [];
  if (daily.length) groups.push({ label: 'Every day', kind: 'daily', minutes: 0, rows: sortRows(daily) });
  byDay.forEach((rows, i) => {
    if (!rows.length) return;
    const minutes = rows.reduce((sum, a) => sum + (a.duration_min ?? 0), 0);
    groups.push({ label: DAY_NAMES[i]!, kind: 'day', minutes, rows: sortRows(rows) });
  });
  if (floating.length)
    groups.push({ label: 'Whenever it fits', kind: 'floating', minutes: 0, rows: sortRows(floating) });
  return groups;
}
