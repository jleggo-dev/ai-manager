import type { IntervalPhase } from '@cadence/shared';
import { INTERVAL_KIND, RING_C } from './tone.ts';

/**
 * The ring-as-session: **one wedge per phase, sized by its seconds**, so the ring's shape IS the
 * session's shape — a long warm-up is a long wedge, and a Tabata's eight thin pairs look nothing
 * like a HIIT's six fat ones before you have pressed anything.
 *
 * Pure and separate from the player so the arc maths can be unit-tested without a clock: the
 * component just maps what comes back onto `<circle>` elements.
 */

/** Visual gap between wedges, in path units on the r=54 circle. */
const GAP = 4;
/** A wedge shorter than this would render as a dot — a 5s recover still has to be visible. */
const MIN_ARC = 2;

export interface RingSegment {
  key: string;
  stroke: string;
  /** `strokeDasharray` — the wedge's arc length, then enough gap to hide the rest of the circle. */
  dash: string;
  /** `strokeDashoffset` — negative, rotating this wedge to its place around the ring. */
  offset: number;
  /** The pro-rata fill on the phase in progress; it alone animates. */
  animated: boolean;
}

/**
 * Wedges for a run at `index` / `progress`. Every phase gets a base wedge — deep once it's behind
 * you, kind-tinted track while it's still ahead — and the phase in progress gets a second wedge
 * over the top, filling pro-rata. Once `done`, every wedge reads as finished.
 */
export function ringSegments(
  phases: readonly IntervalPhase[],
  index: number,
  progress: number,
  done: boolean,
): RingSegment[] {
  const total = phases.reduce((sum, p) => sum + Math.max(0, p.seconds), 0);
  if (total <= 0) return [];
  const segments: RingSegment[] = [];
  let acc = 0;
  phases.forEach((phase, i) => {
    const span = (Math.max(0, phase.seconds) / total) * RING_C;
    const arc = Math.max(MIN_ARC, span - GAP);
    const kind = INTERVAL_KIND[phase.kind];
    const past = done || i < index;
    segments.push({
      key: `p${i}`,
      stroke: past ? kind.done : kind.track,
      dash: `${arc} ${RING_C - arc}`,
      offset: -acc,
      animated: false,
    });
    if (!done && i === index && progress > 0) {
      segments.push({
        key: `f${i}`,
        stroke: kind.fill,
        // Against the full circumference, not the remainder: this wedge grows from nothing, and a
        // second gap term would make it wrap once the arc is long.
        dash: `${Math.max(1, arc * Math.min(1, progress))} ${RING_C}`,
        offset: -acc,
        animated: true,
      });
    }
    acc += span;
  });
  return segments;
}

/** The scale-true strip under the edit sheet: one flex-weighted segment per phase, coloured by
 *  kind. Edit a number and the shape changes — that reshaping IS the feedback loop. */
export function stripSegments(phases: readonly IntervalPhase[]): Array<{ key: string; flex: number; bg: string }> {
  return phases.map((phase, i) => ({
    key: `s${i}`,
    flex: Math.max(1, phase.seconds),
    bg: INTERVAL_KIND[phase.kind].done,
  }));
}
