/**
 * What the person changed about a move during THIS session (walkthrough v3 Phase 5, design A).
 * Two kinds of change, both kept outside the walkthrough itself so the prescription stays what
 * the coach wrote and Undo is a delete:
 *
 *   • a swap — one of the coach's alternatives (or the one she gave for "Something else") played in
 *     the move's place: its name, quantities, cue and video replace the step's, and the step says
 *     `swapped_from` so the log line, the all-steps list and the recap read it as a swap, never a
 *     skip;
 *   • a load — the weight the person added, which the tool writes into each set it logs from then
 *     on (`StepLog.loads`). The step's own `tool.load` stays the plan, so the log line can say
 *     "(plan said bodyweight)".
 *
 * Keyed by step id, or by `stepId:moveIndex` for one move inside a circuit. Pure: the shell keeps
 * the map in state and on disk (sessionInProgress.ts) and derives the steps it shows from here.
 */
import {
  type CircuitExercise,
  type SessionItemAlternative,
  type StepTool,
  type WalkthroughStep,
  inferTool,
  parseLoad,
} from '@cadence/shared';
import type { StepLog } from './state.ts';

export interface MoveChange {
  swap?: SessionItemAlternative;
  load?: string;
}
export type MoveChanges = Record<string, MoveChange>;

/** The map key for a step, or for one move inside a circuit step. */
export function changeKey(stepId: string, moveIndex?: number): string {
  return moveIndex == null ? stepId : `${stepId}:${moveIndex}`;
}

/** The load the person is lifting now on this move, when they changed it. */
export function workingLoad(changes: MoveChanges, key: string): string | undefined {
  return changes[key]?.load;
}

/** An alternative played as a tool: the same inference the session goes through. */
export function alternativeTool(alt: SessionItemAlternative): StepTool {
  return inferTool({ ...alt, video_query: alt.video_query ?? undefined });
}

/** An alternative as a circuit move. */
export function alternativeMove(alt: SessionItemAlternative, from: CircuitExercise): CircuitExercise {
  const move: CircuitExercise = { name: alt.name, swapped_from: from.swapped_from ?? from.name };
  if (alt.reps != null) move.reps = alt.reps;
  if (alt.load) move.load = alt.load;
  if (alt.duration_min && alt.duration_min > 0) move.seconds = Math.round(alt.duration_min * 60);
  if (alt.detail) move.detail = alt.detail;
  if (alt.video_query) move.video_query = alt.video_query;
  // The alternatives stay the ORIGINAL move's, so the sheet can offer the others — and the original.
  if (from.alternatives) move.alternatives = from.alternatives;
  if (alt.load == null && from.suggested_load) move.suggested_load = from.suggested_load;
  return move;
}

/** One step with its changes applied. A swap replaces what the move IS; a load does not touch the
 *  step (the tool is handed it separately), so `tool.load` stays the plan. */
function applyToStep(step: WalkthroughStep, changes: MoveChanges): WalkthroughStep {
  const tool = step.tool;
  if (tool.kind === 'circuit') {
    const exercises = tool.exercises.map((ex, i) => {
      const swap = changes[changeKey(step.id, i)]?.swap;
      return swap ? alternativeMove(swap, ex) : ex;
    });
    return exercises.some((ex, i) => ex !== tool.exercises[i]) ? { ...step, tool: { ...tool, exercises } } : step;
  }
  const swap = changes[step.id]?.swap;
  if (!swap) return step;
  const swapped: WalkthroughStep = {
    ...step,
    title: swap.name,
    tool: alternativeTool(swap),
    swapped_from: step.title,
  };
  if (swap.detail) swapped.body = swap.detail;
  else delete swapped.body;
  if (swap.video_query) swapped.video_query = swap.video_query;
  else delete swapped.video_query;
  return swapped;
}

/** The steps as the person is doing them. Steps with no change come back as the same object. */
export function applyChanges(steps: WalkthroughStep[], changes: MoveChanges): WalkthroughStep[] {
  if (!Object.keys(changes).length) return steps;
  return steps.map((s) => applyToStep(s, changes));
}

/** The alternatives the sheet lists for a move: the coach's, minus the one being played. */
export function swapRows(
  alternatives: SessionItemAlternative[] | undefined,
  playing: string,
  landed: SessionItemAlternative[] = [],
): SessionItemAlternative[] {
  const all = [...(alternatives ?? []), ...landed];
  const seen = new Set<string>([playing.trim().toLowerCase()]);
  return all.filter((a) => {
    const k = a.name.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The sheet's subtitle line, in facts: "GLUTE BRIDGE · SET 1 OF 2 NEXT". */
export function changeSubtitle(
  name: string,
  tool: StepTool,
  log?: StepLog,
  moveIndex?: number,
  round?: number,
): string {
  const head = name.toUpperCase();
  if (tool.kind === 'circuit' && moveIndex != null) {
    return `${tool.exercises[moveIndex]?.name.toUpperCase() ?? head} · ROUND ${(round ?? 0) + 1} OF ${tool.rounds}`;
  }
  const sets = tool.kind === 'reps' ? tool.sets : tool.kind === 'timer' ? tool.sets : undefined;
  if (!sets) return head;
  const done = log && (log.kind === 'reps' || log.kind === 'timed_sets') ? log.sets.length : 0;
  return done >= sets ? `${head} · ${sets} SETS LOGGED` : `${head} · SET ${done + 1} OF ${sets} NEXT`;
}

/** Whether a move can take a weight at all: reps, a timed effort in sets, or a circuit move. */
export function takesLoad(tool: StepTool): boolean {
  return tool.kind === 'reps' || (tool.kind === 'timer' && !!tool.sets) || tool.kind === 'circuit';
}

/** The number the weight sheet opens on: the working load, else the plan's own load when it is a
 *  number (a swapped-in "12 × 40 lb" opens on 40), else the coach's suggestion, else none. */
export function dialStart(
  working: string | undefined,
  plan: string | undefined,
  suggested: string | undefined,
): number {
  return parseLoad(working)?.value ?? parseLoad(plan)?.value ?? parseLoad(suggested)?.value ?? 0;
}
