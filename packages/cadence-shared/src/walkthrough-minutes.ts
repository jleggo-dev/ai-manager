/**
 * How many minutes a step takes — the per-tool floors and the rule that reads an item's own
 * length. Out of walkthrough.ts so that file stays under the size gate.
 */
import { totalMinutes } from './breathing.ts';
import { intervalTotalMinutes } from './interval.ts';
import type { SessionItem } from './types/occurrence.ts';
import type { StepTool, StepToolKind } from './walkthrough.ts';

const DEFAULT_MINUTES: Record<StepToolKind, number> = {
  timer: 1, // timer items always carry a real duration; this is only a floor
  interval: 9, // an interval run computes its real minutes from the plan; this is only a floor
  reps: 3,
  circuit: 8, // circuits compute their own minutes (rounds × items); this is only a floor
  checkoff: 5,
  read: 1,
  photo: 1,
  journal: 3,
  measure: 1,
  breathing: 1, // breathing computes its real minutes from pattern × cycles; this is only a floor
  meditate: 10, // a sit carries its own duration; this is only a floor
  grounding: 3, // a grounding flow has no required length — this is a nominal slot on the trail
  feeling_log: 1, // twenty seconds, every time
  rings: 1,
  insight: 1,
};

/** Round a positive minute value; treat missing/≤0 as absent. A breathing step ignores any stated
 *  duration — its real length is pattern × clamped cycles, which is arithmetic, not a guess. */
export function minutesOf(item: SessionItem, tool: StepTool): number {
  if (tool.kind === 'breathing') return totalMinutes(tool.pattern, tool.cycles);
  if (tool.kind === 'meditate') return Math.max(1, Math.round(tool.seconds / 60));
  // Same rule as breathing: an interval run's length is arithmetic over its own numbers, so a
  // `duration_min` the coach also wrote down is ignored rather than allowed to contradict the ring.
  if (tool.kind === 'interval') return intervalTotalMinutes(tool.plan);
  const d = item.duration_min;
  // Sets of a timed effort: `duration_min` is one set, so the step is sets × that plus the rests.
  if (tool.kind === 'timer' && tool.sets && typeof d === 'number' && d > 0) {
    return Math.max(1, Math.round(tool.sets * d + ((tool.sets - 1) * (tool.rest_sec ?? 0)) / 60));
  }
  if (typeof d === 'number' && d > 0) return Math.round(d);
  return DEFAULT_MINUTES[tool.kind];
}
