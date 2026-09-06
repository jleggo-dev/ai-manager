/**
 * How the forecast is written in the weather sheet — the tab names, the hour and day labels, and
 * the one line the coach says when the provider's horizon is shorter than the tab's.
 *
 * Pure, so the labels can be tabled: a day that reads "Tomorrow" when it is today, or an hour
 * written in the device's zone when the forecast was cut in another, fails silently on screen.
 */
import type { ClockUnit } from '@cadence/shared';
import { minutesToClock } from '../../lib/clock.ts';

export type ForecastTab = 'hourly' | 'week' | 'fortnight';

/** The three ranges, in tab order. `days` is how many rows the tab promises. */
export const FORECAST_TABS: readonly { id: ForecastTab; label: string; days?: number }[] = [
  { id: 'hourly', label: 'Hourly' },
  { id: 'week', label: '7 days', days: 7 },
  { id: 'fortnight', label: '14 days', days: 14 },
];

/** The local calendar date (YYYY-MM-DD) of an instant in `tz`; the device's zone when unusable. */
export function localDateIn(at: Date, tz: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz?.trim() || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  }
}

/** The hour of the day (0–23) an instant falls on in `tz`; the device's zone when unusable. */
export function localHourIn(at: Date, tz: string | null | undefined): number {
  const read = (timeZone?: string) =>
    Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(at)) % 24;
  try {
    return read(tz?.trim() || undefined);
  } catch {
    return read();
  }
}

/**
 * The strip's label for an hour: "Now" for the hour in progress, then the clock the person chose
 * — "15:00", or "3 pm" (the strip has no room for ":00 pm", and an hour is always on the hour).
 */
export function hourLabel(iso: string, tz: string | null | undefined, clock: ClockUnit, now: Date): string {
  const at = new Date(iso);
  if (at.getTime() <= now.getTime()) return 'Now';
  const h = localHourIn(at, tz);
  if (clock === '24h') return minutesToClock(h * 60, '24h');
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`;
}

/** "Today", "Tomorrow", then the weekday and the date — "Wed 10" — so a fortnight stays legible. */
export function dayLabel(date: string, todayIso: string): string {
  if (date === todayIso) return 'Today';
  if (date === nextDay(todayIso)) return 'Tomorrow';
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
  return `${weekday} ${Number(date.slice(8, 10))}`;
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** A chance of rain worth a number: from one in five up. Below that the row says nothing. */
export function precipLabel(chance: number | null | undefined): string | null {
  if (chance == null || chance < 0.2) return null;
  return `${Math.round(chance * 100)}%`;
}

/**
 * What the coach says under a list shorter than its tab promised. Apple sees ten days and
 * OpenWeatherMap five; a fourteen-day tab over either shows what there is and says so, rather
 * than filling the rest with rows nobody forecast.
 */
export function horizonLine(shown: number, promised: number): string | null {
  if (shown >= promised) return null;
  return `That's as far ahead as I can see — ${shown} ${shown === 1 ? 'day' : 'days'}.`;
}
