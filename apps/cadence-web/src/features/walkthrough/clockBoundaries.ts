import { bellMarks, expandIntervalPhases, type IntervalPlan, type MeditateBells } from '@cadence/shared';
import { CHIME_DONE, CHIME_RECOVER, CHIME_SWITCH, CHIME_WORK } from './tools/chime-tones.ts';

export type ClockKind = 'timer' | 'timed_set' | 'interval' | 'circuit_move' | 'sit' | 'breath';

/**
 * A clock as a tool registers it with the running-clock store (runningClock.ts): the instant this
 * run began, what was done before it, and enough of the step to know when it chimes. Elapsed
 * seconds are `base + (now - startedAt) / 1000`, the same arithmetic every tool's wall clock uses.
 */
export interface RunningClockSpec {
  stepId: string;
  /** The step's title — what the pill and a pocket notification call it. */
  title: string;
  kind: ClockKind;
  startedAt: number;
  base: number;
  /** The whole run in seconds: the target of a timer or one timed set, the interval's total, the
   *  sit's length, the pacer's rounds end to end. */
  targetSec: number;
  /** Whether the chimes sound. The vibration happens either way. */
  chime: boolean;
  /** A two-sided hold or carry chimes halfway. */
  switchSides?: boolean;
  /** The interval's plan, so the phase boundaries can be derived. */
  plan?: IntervalPlan;
  /** A sit's bells: none, start and end, or every N minutes. */
  bells?: { bells: MeditateBells; intervalMin: number };
}

export type BoundaryKind = 'work' | 'recover' | 'neutral' | 'switch' | 'bell' | 'done';

/** One moment the clock marks: when (seconds into the run), what to play, and what to call it. */
export interface ClockBoundary {
  atSec: number;
  kind: BoundaryKind;
  /** Plain words for the moment — "Work", "Recover", "Switch sides", "Bell", "Time's up". */
  label: string;
  /** How long the phase starting here lasts, for an interval ("Recover · 30 s"). */
  seconds?: number;
  /** The moment's own voice; absent, it is the plain two-note chime (`playChime`). */
  tones?: readonly number[];
  vibrateMs: number;
}

/**
 * Every moment a registered clock chimes, in order, from the start of the run — pure arithmetic
 * over the spec, so the store can schedule them and the pocket tier can book them from the same
 * list. The start itself is never a boundary: the tool announces that inside the Start tap.
 *
 *  • a timer, one timed set, a circuit move: the halfway turn-over for a two-sided hold, then the
 *    target. An effort that keeps running past its target has nothing more to mark.
 *  • an interval: each phase handover after the first (rising for work, falling for recover, the
 *    recover note for a rest or cool-down), then the three-note end.
 *  • a sit: the bells off the shared schedule (`bellMarks`) — every N minutes, and the end.
 *  • the breath pacer: the end of the last round.
 */
export function clockBoundaries(spec: RunningClockSpec): ClockBoundary[] {
  switch (spec.kind) {
    case 'interval':
      return spec.plan ? intervalBoundaries(spec.plan) : [];
    case 'sit':
      return sitBoundaries(spec.targetSec, spec.bells);
    case 'breath':
      return [{ atSec: spec.targetSec, kind: 'done', label: 'Done', vibrateMs: 60 }];
    default:
      return countdownBoundaries(spec.targetSec, spec.switchSides ?? false);
  }
}

function countdownBoundaries(targetSec: number, switchSides: boolean): ClockBoundary[] {
  const out: ClockBoundary[] = [];
  if (switchSides && targetSec >= 2) {
    out.push({ atSec: targetSec / 2, kind: 'switch', label: 'Switch sides', tones: CHIME_SWITCH, vibrateMs: 30 });
  }
  out.push({ atSec: targetSec, kind: 'done', label: "Time's up", vibrateMs: 60 });
  return out;
}

function intervalBoundaries(plan: IntervalPlan): ClockBoundary[] {
  const phases = expandIntervalPhases(plan);
  const out: ClockBoundary[] = [];
  let acc = 0;
  phases.forEach((phase, i) => {
    if (i > 0) {
      const kind: BoundaryKind = phase.kind === 'work' ? 'work' : phase.kind === 'recover' ? 'recover' : 'neutral';
      out.push({
        atSec: acc,
        kind,
        label: phase.label,
        seconds: phase.seconds,
        tones: phase.kind === 'work' ? CHIME_WORK : CHIME_RECOVER,
        vibrateMs: 40,
      });
    }
    acc += Math.max(0, phase.seconds);
  });
  if (acc > 0) out.push({ atSec: acc, kind: 'done', label: 'Done', tones: CHIME_DONE, vibrateMs: 60 });
  return out;
}

function sitBoundaries(targetSec: number, bells: RunningClockSpec['bells']): ClockBoundary[] {
  if (!bells || bells.bells === 'none') return [];
  // Minutes the way the sit itself counts them: whole, floored at one.
  const minutes = Math.max(1, Math.round(targetSec / 60));
  const marks = bellMarks(minutes, bells.bells, bells.intervalMin);
  const last = marks[marks.length - 1];
  return marks.map((atSec) => ({ atSec, kind: atSec === last ? 'done' : 'bell', label: 'Bell', vibrateMs: 40 }));
}
