/**
 * The gate (owner, 2026-09-09): what a tap on the trail asks before it opens anything.
 *
 * The days past the weekly check-in are locked because the check-in can redefine them. A tap on
 * one is not an error — it is someone planning ahead — so it opens a prompt with the honest
 * choices, worded for where in the week they are:
 *
 *   - `early`   day 1–3 of the plan, a locked day: "build next week already?" (yes / not yet)
 *   - `midweek` day 4 on, a locked day: check in now / build next week / just browsing
 *   - `due`     the check-in's own day or later, ANY day from the check-in on (built or not):
 *               check in now / later today / just build my week (the skipped check-in)
 *
 * "Later today" dismisses the prompt for the rest of the local day — the check-in is then a thing
 * they pick from the plan themselves (the card still stands) — and the tapped activity opens.
 * A locked day still prompts after that: the prompt is the only door a locked day has.
 *
 * Pure, and table-tested (`checkinGate.test.ts`): a router that decides behaviour fails silently
 * (CLAUDE.md), and this one decides whether a tap opens a sheet or asks a question.
 */
export type GateVariant = 'early' | 'midweek' | 'due';

export interface GateWeekState {
  ends_on: string;
  started_on?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Which day of the plan today is, 1-based. Unknown start → 4: the mid-week wording is the safe
 *  one ("we're still working through this week" is true whatever the day). */
export function planDay(startedOn: string | undefined, todayIso: string): number {
  if (!startedOn || !ISO_DATE.test(startedOn) || !ISO_DATE.test(todayIso)) return 4;
  const days = Math.round((Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${startedOn}T00:00:00Z`)) / DAY_MS);
  return Math.max(1, days + 1);
}

/** Day 1–3 gets the lighter ask; day 4 on the full one (owner, 2026-09-09: ">3 days into plan"). */
export const EARLY_DAYS = 3;

export function gateFor({
  date,
  locked,
  todayIso,
  weekState,
  laterOn,
}: {
  /** The day the tapped node sits on. */
  date: string;
  /** Is that day behind the lock (trailLock.ts)? */
  locked: boolean;
  todayIso: string;
  weekState: GateWeekState | null | undefined;
  /** The local day "Later today" was last tapped on, if any (`readLaterOn`). */
  laterOn: string | null;
}): { variant: GateVariant; day: number } | null {
  if (!weekState || !ISO_DATE.test(weekState.ends_on) || !ISO_DATE.test(todayIso)) return null;
  const day = planDay(weekState.started_on, todayIso);
  if (todayIso >= weekState.ends_on) {
    // The check-in's day (or later). A locked day always asks; an open day from the check-in on
    // asks once a day — "later today" means later, not never.
    if (locked) return { variant: 'due', day };
    if (date >= weekState.ends_on && laterOn !== todayIso) return { variant: 'due', day };
    return null;
  }
  if (!locked) return null;
  return { variant: day <= EARLY_DAYS ? 'early' : 'midweek', day };
}

/* ── "Later today", remembered for the day — per device, never sent anywhere ─────────────── */

const LATER_KEY = 'cadence.checkin-gate.later';

export function readLaterOn(): string | null {
  try {
    const v = localStorage.getItem(LATER_KEY);
    return v && ISO_DATE.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeLaterOn(todayIso: string): void {
  try {
    localStorage.setItem(LATER_KEY, todayIso);
  } catch {
    // A browser that refuses storage just asks again on the next tap — the safe failure.
  }
}
