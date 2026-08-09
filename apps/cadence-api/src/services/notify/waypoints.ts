import type { Goal, NudgeWaypoint } from '@cadence/shared';
import { addDays, daysBetween } from './producers/clock.ts';

/**
 * Goals → the four waypoints on the way to a day someone is aiming at.
 *
 * Six weeks, three weeks, one week, and the day before. The spacing is the message: far out, a
 * waypoint is orientation ("that is still six weeks away, you are fine"); close in, it is
 * preparation. A weekly countdown would be a metronome of pressure, and a single day-before
 * reminder would be a surprise.
 *
 * Pure and I/O-free so the date arithmetic — which is the only part that can be wrong — is
 * testable without a database.
 */

/** Weeks out, in order. 0 is the day before. */
const WAYPOINT_WEEKS = [6, 3, 1, 0] as const;

/** How many days before the target each waypoint lands on. */
function offsetDays(weeksOut: number): number {
  return weeksOut === 0 ? 1 : weeksOut * 7;
}

/** The dated things a goal is aiming at: its milestones, then the goal's own end date. */
function targetsFor(goal: Goal): Array<{ label: string; date: string }> {
  const out: Array<{ label: string; date: string }> = [];
  for (const m of goal.milestones ?? []) {
    // A milestone already reached is not a day to count toward.
    if (m.target_date && !m.done) out.push({ label: m.label, date: m.target_date });
  }
  if (goal.timeframe?.end) out.push({ label: goal.title, date: goal.timeframe.end });
  return out;
}

/**
 * Every waypoint falling on or after `today`, for the goals the user has committed to.
 *
 * `totalDays` is the goal's whole span when it has a start, which is what lets the one-week line
 * for a standing practice say "Thirty days, nearly done" — a number about how far they have come
 * rather than how far is left.
 */
export function waypointsForGoals(goals: Goal[], today: string): NudgeWaypoint[] {
  const out: NudgeWaypoint[] = [];
  for (const goal of goals) {
    const start = goal.timeframe?.start;
    for (const target of targetsFor(goal)) {
      const totalDays = start ? daysBetween(start, target.date) : NaN;
      for (const weeksOut of WAYPOINT_WEEKS) {
        const date = addDays(target.date, -offsetDays(weeksOut));
        if (date < today) continue; // already passed — a waypoint is never sent late
        out.push({
          label: target.label,
          date,
          weeksOut,
          area: goal.area,
          ...(Number.isFinite(totalDays) && totalDays > 0 ? { totalDays } : {}),
        });
      }
    }
  }
  // Soonest first, so a device at the iOS ceiling keeps the waypoints that are actually near.
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}
