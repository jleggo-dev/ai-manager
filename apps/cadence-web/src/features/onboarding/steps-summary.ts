/**
 * Daily step buckets → the bounded step summary that goes in the digest.
 *
 * The digest is an abstraction (see validation/health.ts on the server): ~90 daily numbers become
 * an average, a count of days we actually saw, and a weekly shape. That shape is the point —
 * "15,900 steps a day" and "15,900 a day, but it was 22,000 in May and 9,000 last week" call for
 * completely different plans, and only one of them is visible from an average.
 *
 * Bounds mirror apps/cadence-api/src/validation/health.ts exactly. As with workouts, a single
 * implausible day (a sensor fault, a phone in a tumble dryer) must cost its own accuracy and
 * nothing else — the payload is validated as a whole, so an unclamped outlier would reject the
 * entire history.
 */
import type { HealthDigestSteps, HealthDigestStepsWeek } from '@cadence/shared';
import type { DailySteps } from '../../lib/capability/index.ts';

/** ~13 weeks covers the 90-day window; 14 leaves room for a partial week at each end. */
export const DIGEST_STEPS_MAX_WEEKS = 14;
const MAX_STEPS_PER_DAY = 200_000;
const TRAILING_DAYS = 7;

const round0 = (n: number) => Math.round(n);

/** Monday of the week containing `date` (YYYY-MM-DD). Weekday math in UTC: the date string is
 *  already the device's wall-clock day, so there is no zone left to get wrong. */
function weekStart(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(t)) return date;
  const d = new Date(t);
  // getUTCDay: 0 = Sunday. Shift so Monday is 0 and Sunday is 6.
  const offset = (d.getUTCDay() + 6) % 7;
  return new Date(t - offset * 86_400_000).toISOString().slice(0, 10);
}

/** Days with no data are DROPPED, never counted as zero: a phone left at home is missing
 *  evidence, and averaging it in as a sedentary day would understate a real person's activity. */
function observedDays(samples: DailySteps[]): DailySteps[] {
  return samples
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s?.date ?? '') && Number.isFinite(s.steps) && s.steps > 0)
    .map((s) => ({ date: s.date, steps: Math.min(round0(s.steps), MAX_STEPS_PER_DAY) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function averageOver(days: DailySteps[]): number {
  if (!days.length) return 0;
  return round0(days.reduce((a, d) => a + d.steps, 0) / days.length);
}

function weeklyShape(days: DailySteps[]): HealthDigestStepsWeek[] {
  const byWeek = new Map<string, DailySteps[]>();
  for (const d of days) {
    const k = weekStart(d.date);
    byWeek.set(k, [...(byWeek.get(k) ?? []), d]);
  }
  return (
    [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      // Newest weeks are the ones a plan is built from, so an over-long history drops from the
      // OLD end — the opposite of the workout caps, which drop the least-frequent types.
      .slice(-DIGEST_STEPS_MAX_WEEKS)
      .map(([weekStartISO, list]) => ({
        weekStartISO,
        avgPerDay: averageOver(list),
        daysObserved: list.length,
      }))
  );
}

/**
 * Returns null when nothing was read — the caller then omits `dailySteps` entirely rather than
 * storing zeros. "We could not read it" and "they do not move" must stay distinguishable all the
 * way to the planner, because one of them is a reason to build a bigger plan.
 */
export function summarizeDailySteps(samples: DailySteps[]): HealthDigestSteps | null {
  const days = observedDays(samples ?? []);
  if (!days.length) return null;

  const newest = days[days.length - 1]!.date;
  const cutoff = new Date(Date.parse(`${newest}T00:00:00Z`) - (TRAILING_DAYS - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const trailing = days.filter((d) => d.date >= cutoff);

  return {
    daysObserved: days.length,
    avgPerDay: averageOver(days),
    avgPerDayLast7: trailing.length ? averageOver(trailing) : null,
    byWeek: weeklyShape(days),
  };
}
