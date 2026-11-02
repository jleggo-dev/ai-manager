import type { WeekDay, WeekEntry } from '../../../lib/api.ts';

/**
 * The pure half of the week view: how a day is named, and how an entry reads once the person has
 * toggled its change off. Kept out of the components so both are table-tested.
 */

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
const DAY_MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const NARROW = new Intl.DateTimeFormat('en-US', { weekday: 'narrow', timeZone: 'UTC' });

/** Noon UTC, so a bare YYYY-MM-DD never slips a day in any timezone. */
const at = (date: string) => new Date(`${date}T12:00:00Z`);

/** "Today", "Tomorrow", then "Tue · Nov 3". `position` is the day's place in the week (0 = today). */
export function dayLabel(date: string, position: number): string {
  if (position === 0) return 'Today';
  if (position === 1) return 'Tomorrow';
  return `${WEEKDAY.format(at(date))} · ${DAY_MONTH.format(at(date))}`;
}

/** "S", "M", "T"… for the strip. */
export const dayLetter = (date: string): string => NARROW.format(at(date));

/**
 * An entry as it reads with the toggles as they stand. A toggled-off change shows the plan as it
 * is now: a session it would add disappears (null), and one it would move or drop stays where it
 * is, unchanged. A changed session falls back to the time it had.
 */
export function asToggled(e: WeekEntry, enabled: Record<number, boolean>): WeekEntry | null {
  if (e.index == null || enabled[e.index] !== false) return e;
  if (e.kind === 'new') return null;
  if (e.kind === 'was') return { ...e, kind: 'same' };
  if (e.kind === 'changed')
    return { ...e, kind: 'same', time: e.was_time !== undefined ? e.was_time : e.time, was_time: undefined };
  return e;
}

/** The week with the toggles applied — what the strip and the full view both draw. */
export function weekAsToggled(week: WeekDay[], enabled: Record<number, boolean>): WeekDay[] {
  return week.map((d) => ({
    date: d.date,
    entries: d.entries.map((e) => asToggled(e, enabled)).filter((e): e is WeekEntry => e !== null),
  }));
}

/** Does this day hold any part of the change? The strip accents it. */
export const dayChanges = (d: WeekDay): boolean => d.entries.some((e) => e.kind !== 'same');
