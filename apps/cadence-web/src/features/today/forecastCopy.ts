/**
 * How the forecast is written in the weather sheet — the tab names, and the hour and day labels.
 *
 * Pure, so the labels can be tabled: a day that reads "Tomorrow" when it is today, an hour
 * written in the device's zone when the forecast was cut in another, or a tab that promises more
 * days than the list under it, fails silently on screen.
 */
import type { ClockUnit } from '@cadence/shared';
import { minutesToClock } from '../../lib/clock.ts';

export type ForecastTab = 'hourly' | 'days';

/** The most days the sheet will ever promise: Apple's ten. Nobody forecasts fourteen. */
export const MAX_FORECAST_DAYS = 10;

export type ForecastTabSpec = { id: ForecastTab; label: string; days?: number };

/**
 * The tabs, in order, for a series with `dayCount` days: Hourly, then ONE days tab named for what
 * is actually there — "10 days" from Apple, "5 days" from OpenWeatherMap — and none when the
 * provider gave no days at all.
 *
 * There used to be three — Hourly, 7 days, 14 days — with the coach saying how far she got under
 * a list shorter than its tab. The owner's reading was the right one: a tab that says fourteen and
 * shows ten is a promise, not a range, and "if we can't show 14 days, don't have an option for
 * it" (2026-09-07). So the label IS the count, and the count is capped at the ten Apple sees.
 */
export function forecastTabs(dayCount: number): readonly ForecastTabSpec[] {
  const promised = Math.min(Math.max(0, Math.floor(dayCount)), MAX_FORECAST_DAYS);
  const tabs: ForecastTabSpec[] = [{ id: 'hourly', label: 'Hourly' }];
  if (promised > 0) tabs.push({ id: 'days', label: `${promised} ${promised === 1 ? 'day' : 'days'}`, days: promised });
  return tabs;
}

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

/** "Today", "Tomorrow", then the weekday and the date — "Wed 10" — so ten days stay legible. */
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
