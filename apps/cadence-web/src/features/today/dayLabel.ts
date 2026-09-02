import type { PlanDay } from '../../lib/api.ts';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * "TODAY · TUE 1 SEP", "TOMORROW · WED 2 SEP", "YESTERDAY · MON 31 AUG", or just the stamp.
 *
 * Relative to TODAY's position in the list, not to the top of it — the top is last week once the
 * trail has been scrolled back (2026-09-01), and "tomorrow" must not move with it.
 */
export function dayLabel(day: PlanDay, index: number, todayIndex: number): string {
  const mon = MONTHS[Number(day.date.slice(5, 7)) - 1] ?? '';
  const stamp = `${day.weekday.slice(0, 3).toUpperCase()} ${day.dayNum} ${mon}`;
  if (day.isToday) return `TODAY · ${stamp}`;
  if (index === todayIndex + 1) return `TOMORROW · ${stamp}`;
  if (index === todayIndex - 1) return `YESTERDAY · ${stamp}`;
  return stamp;
}

/** Which way a day's crescent sweeps, from the DATE rather than the list index — so loading
 *  last week on top does not mirror every day already on screen. */
export const daySide = (date: string): number => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000) % 2;
