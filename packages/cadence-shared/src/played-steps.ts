/**
 * The steps the shell shows for a played shape (walkthrough v3 Phase 6), the way `applyChanges`
 * derives them for a swap: the prescription in, the steps as the person plays them out. A plain
 * group comes back as the very step object it holds, so everything keyed by step id — logs,
 * changes, tests — is untouched when nothing was rearranged. Any other group becomes a step that
 * carries `play`: the turns it runs through, which the web's StepGroup renders and logs one turn
 * at a time.
 *
 * Also the per-turn log and its fold back into a step's sets, so a set logged inside a group or
 * on its own counts towards the step it belongs to, in set order.
 */
import type { SetLoads } from './set-loads.ts';
import type { CircuitExercise, WalkthroughStep } from './walkthrough.ts';
import {
  type CombineMode,
  type PlayedShape,
  type Turn,
  distinctSteps,
  groupRounds,
  isPlain,
  normalizeShape,
  setCount,
  turnKey,
} from './played-shape.ts';
import { groupTitle } from './played-lines.ts';

export interface GroupPlay {
  groupId: string;
  mode?: CombineMode;
  turns: Turn[];
  rounds: number;
  /** The member steps' titles, in order of first appearance. */
  names: string[];
}

export interface PlayedStep extends WalkthroughStep {
  play?: GroupPlay;
}

/** What one turn asks for: a count of reps or of seconds, and the load the plan names. */
export interface TurnTarget {
  kind: 'reps' | 'seconds';
  value?: number;
  load?: string;
}

export function turnTarget(step: Pick<WalkthroughStep, 'tool'>): TurnTarget {
  const t = step.tool;
  if (t.kind === 'timer') return { kind: 'seconds', value: t.seconds, ...(t.load ? { load: t.load } : {}) };
  if (t.kind === 'reps')
    return { kind: 'reps', ...(t.reps != null ? { value: t.reps } : {}), ...(t.load ? { load: t.load } : {}) };
  return { kind: 'reps' };
}

/** Minutes one set of a step takes, from the step's own minutes. */
export function turnMinutes(step: Pick<WalkthroughStep, 'tool' | 'minutes'>): number {
  return Math.max(1, Math.round(step.minutes / setCount(step.tool)));
}

/**
 * The steps as played. Runs the shape through `normalizeShape` first, so a stale shape can never
 * drop a set; a default shape yields the steps as they were given, same objects.
 */
export function applyShape(steps: readonly WalkthroughStep[], shape: PlayedShape): PlayedStep[] {
  const byId = new Map(steps.map((s) => [s.id, s] as const));
  // Every turn names a step in `steps` once normalized, so the lookups below cannot miss.
  const stepOf = (id: string) => byId.get(id) as WalkthroughStep;
  return normalizeShape(shape, steps).map((group) => {
    const ids = distinctSteps(group);
    const members = ids.map(stepOf);
    const one = members[0];
    if (one && isPlain(group, steps)) return one;
    const minutes = group.turns.reduce((n, t) => n + turnMinutes(stepOf(t.stepId)), 0);
    const play: GroupPlay = {
      groupId: group.id,
      ...(group.mode ? { mode: group.mode } : {}),
      turns: group.turns,
      rounds: groupRounds(group),
      names: members.map((m) => m.title),
    };
    if (one && members.length === 1) {
      // One step's set (or some of its sets) in a place of its own: the step, with these turns.
      return { ...one, id: group.id, minutes, play };
    }
    const exercises: CircuitExercise[] = members.map((m) => {
      const target = turnTarget(m);
      return {
        name: m.title,
        ...(target.kind === 'reps' && target.value != null ? { reps: target.value } : {}),
        ...(target.kind === 'seconds' && target.value != null ? { seconds: target.value } : {}),
        ...(target.load ? { load: target.load } : {}),
        ...(m.video_query ? { video_query: m.video_query } : {}),
        ...(m.alternatives ? { alternatives: m.alternatives } : {}),
        ...(m.suggested_load ? { suggested_load: m.suggested_load } : {}),
        ...(m.swapped_from ? { swapped_from: m.swapped_from } : {}),
      };
    });
    return {
      id: group.id,
      title: groupTitle(play.names),
      minutes,
      // A combined group plays as a circuit of its members (the design's ruling), so the tool
      // says so; the turns themselves are in `play`.
      tool: { kind: 'circuit', rounds: play.rounds, exercises },
      skippable: true,
      play,
    };
  });
}

/* ── Per-turn logs ── */

/** One turn as logged: the reps or seconds done, and the load it was done at when one applies. */
export interface TurnLog {
  value: number;
  load?: string | null;
}

/** Keyed by `turnKey` — a set's log survives any move of that set between groups. */
export type TurnLogs = Record<string, TurnLog>;

export interface FoldedSets {
  sets: number[];
  loads?: SetLoads;
}

/**
 * A step's logged turns, folded into the `sets` list its ordinary log keeps, in set order. Only
 * the turns in `turns` are folded (a group folds its own; the recap folds a spread step's
 * singles), so a set appears once. `loads` comes back only when some set was done at a load
 * other than the plan's, which is when the log line has something to say about it.
 */
export function foldTurns(
  stepId: string,
  turns: readonly Turn[],
  logs: TurnLogs,
  planLoad?: string,
): FoldedSets | null {
  const mine = turns.filter((t) => t.stepId === stepId && logs[turnKey(t)]).sort((a, b) => a.set - b.set);
  if (mine.length === 0) return null;
  const sets = mine.map((t) => logs[turnKey(t)]?.value ?? 0);
  const loads = mine.map((t) => logs[turnKey(t)]?.load ?? planLoad ?? null);
  const differs = loads.some((l) => (l ?? null) !== (planLoad ?? null));
  return differs ? { sets, loads } : { sets };
}

/** How many of a group's turns are logged, and how many rounds that completes. */
export function groupProgress(turns: readonly Turn[], logs: TurnLogs): { turns: number; rounds: number } {
  const done = turns.filter((t) => logs[turnKey(t)]);
  const rounds = groupRounds({ turns });
  let full = 0;
  for (let r = 0; r < rounds; r++) {
    const inRound = turns.filter((t) => t.set === r);
    if (inRound.length && inRound.every((t) => logs[turnKey(t)])) full = r + 1;
    else break;
  }
  return { turns: done.length, rounds: full };
}
