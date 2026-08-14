import type { Activity } from '@cadence/shared';

/**
 * The density hard line (owner, 2026-08-14: "this has to be a hard line for us or people won't
 * use the app"). Round 4 proved prose can't hold it: with adjacents default-on and "aim for 3-5"
 * in the prompt, a real plan still landed at 1-2 user items per day. So the floor is CODE — the
 * plan is measured after synthesis, and a thin week triggers ONE repair pass that asks for small
 * anchored routines on the thin days. The explicit-minimal exception stays a prompt concern: the
 * repair steer restates it, and a repair that comes back unchanged is accepted (never looped).
 */

export const DENSITY_FLOOR = 3;

const WEEK = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

/** Does this RRULE fire on `day`? Mirrors probe-plan-shape's reading: DAILY (interval 1),
 *  WEEKLY;BYDAY=…; anything unrecognized counts as "not today" — under-counting never
 *  triggers a repair that isn't owed. */
export function firesOn(recurrence: string, day: string): boolean {
  const r = (recurrence ?? '').toUpperCase();
  if (!r.includes('FREQ=')) return false;
  if (r.includes('FREQ=DAILY')) return !r.includes('INTERVAL=') || r.includes('INTERVAL=1');
  if (r.includes('FREQ=WEEKLY')) {
    const m = r.match(/BYDAY=([A-Z,]+)/);
    return m ? m[1]!.split(',').includes(day) : false;
  }
  return false;
}

export interface DensityRead {
  /** user-kind items per weekday, MO..SU. */
  perDay: number[];
  /** Days with at least one user item — rest days don't count against the floor. */
  activeDays: number;
  /** Active days holding fewer than DENSITY_FLOOR user items. */
  thinDays: string[];
  /** TRUE when the majority of active days are thin — the repair trigger. */
  needsRepair: boolean;
}

/** Measure a synthesized plan's day shape. Pure — unit-tested against the observed round-4 week. */
export function readDensity(activities: Array<Partial<Activity>>): DensityRead {
  const user = activities.filter((a) => a.kind !== 'system');
  const perDay = WEEK.map((d) => user.filter((a) => firesOn(String(a.schedule?.recurrence ?? ''), d)).length);
  const active = WEEK.filter((_, i) => perDay[i]! > 0);
  const thinDays = active.filter((d) => perDay[WEEK.indexOf(d)]! < DENSITY_FLOOR);
  return {
    perDay,
    activeDays: active.length,
    thinDays: [...thinDays],
    needsRepair: active.length > 0 && thinDays.length * 2 > active.length,
  };
}

/** The repair instruction — rides as user_steer on the one repair synthesis. */
export function densityRepairSteer(read: DensityRead): string {
  return (
    `DENSITY REPAIR: this plan's active days are too thin (${read.thinDays.join(', ')} hold fewer than ` +
    `${DENSITY_FLOOR} things). Keep EVERY existing activity exactly as drafted — same titles, same days, same ` +
    `times — and ADD small anchored support routines (5-10 minutes, tied to waking, lunch, or bed; suggested: true) ` +
    `until a normal active day holds at least ${DENSITY_FLOOR} items. Respect the availability windows and session ` +
    `budget. The ONE exception that overrides this instruction: if the person explicitly asked for one small ` +
    `commitment or a minimal plan, return the drafted activities unchanged.`
  );
}
