/**
 * The session as the person plays it (walkthrough v3 Phase 6, R2 — owner 2026-11-03: the
 * person may change the structure). The coach prescribes steps; the person plays an ordered
 * list of **groups**, each a list of **turns**, and a turn is one set of one step. Pulling a set
 * out of its step and putting two steps' sets into one group are the two things the design's
 * Rearrange sheet does, and both are only moves on this list — the prescription is never edited.
 *
 * Pure, like changes.ts on the web side: the shape lives OUTSIDE the walkthrough as data the
 * shell keeps in state and on disk, `applyShape` derives the steps the shell shows from it, and
 * every operation here is `old shape → new shape`, so Undo is a stack of old shapes
 * (`ShapeHistory`): a snapshot per step is trivially right, where an inverse for a drag with gap
 * arithmetic is the kind of thing that is wrong in one corner for weeks.
 *
 * A **plain** group is one step's sets, all of them, in order: it plays and logs exactly as the
 * step always did. Anything else plays through the turns (StepGroup on the web): a one-turn
 * group is a set on its own in a new place; a group with turns from two or more steps is a
 * circuit of those turns, in the order the pills show.
 */
import type { StepTool, WalkthroughStep } from './walkthrough.ts';

export interface Turn {
  stepId: string;
  /** 0-based set index within the step. */
  set: number;
}

export type CombineMode = 'alternate' | 'sequence';

export interface PlayedGroup {
  id: string;
  turns: Turn[];
  /** Set by Combine, so the words ("alternating", "in sequence") survive a later drag. */
  mode?: CombineMode;
}

export type PlayedShape = PlayedGroup[];

/** What one turn of a step asks for: a count of reps, a count of seconds, or the whole step. */
export type TurnKind = 'reps' | 'seconds' | 'whole';

export function turnKind(tool: StepTool): TurnKind {
  if (tool.kind === 'reps') return 'reps';
  if (tool.kind === 'timer') return 'seconds';
  return 'whole';
}

/** How many turns a step plays as: its sets, or one. A prescribed circuit is one turn. */
export function setCount(tool: StepTool): number {
  if (tool.kind === 'reps') return Math.max(1, Math.round(tool.sets));
  if (tool.kind === 'timer') return Math.max(1, Math.round(tool.sets ?? 1));
  return 1;
}

/** Whether a group's sets can be combined with another's or dragged out one at a time. */
export function canRearrangeTurns(tool: StepTool): boolean {
  return turnKind(tool) !== 'whole' && setCount(tool) >= 1;
}

export function turnKey(t: Turn): string {
  return `${t.stepId}:${t.set}`;
}

/** One group per step, one turn per set — the prescription as the coach wrote it. */
export function defaultShape(steps: readonly WalkthroughStep[]): PlayedShape {
  return steps.map((s, i) => ({
    id: `g${i + 1}`,
    turns: Array.from({ length: setCount(s.tool) }, (_, set) => ({ stepId: s.id, set })),
  }));
}

/** A fresh id that no group in the shape carries. */
export function nextGroupId(shape: PlayedShape): string {
  const max = shape.reduce((m, g) => {
    const n = /^g(\d+)$/.exec(g.id);
    return n ? Math.max(m, Number(n[1])) : m;
  }, 0);
  return `g${max + 1}`;
}

export function distinctSteps(group: PlayedGroup): string[] {
  const out: string[] = [];
  for (const t of group.turns) if (!out.includes(t.stepId)) out.push(t.stepId);
  return out;
}

/** Turns from two or more steps: plays as a circuit of its turns. */
export function isCombined(group: PlayedGroup): boolean {
  return distinctSteps(group).length > 1;
}

/** One step, all of its sets, in order — plays as the step always did. */
export function isPlain(group: PlayedGroup, steps: readonly WalkthroughStep[]): boolean {
  const ids = distinctSteps(group);
  if (ids.length !== 1) return false;
  const step = steps.find((s) => s.id === ids[0]);
  if (!step) return false;
  const n = setCount(step.tool);
  return group.turns.length === n && group.turns.every((t, i) => t.set === i);
}

/** Rounds a group plays: the highest set index in it, plus one. */
export function groupRounds(group: { turns: readonly Turn[] }): number {
  return group.turns.reduce((m, t) => Math.max(m, t.set + 1), 0);
}

/** Alternate: round by round, each step's turn of that round in the groups' order. Sequence: one
 *  group's turns, then the other's. Combining a group with itself, or an id that is not there,
 *  changes nothing. The new group takes the earlier group's place. */
export function combine(shape: PlayedShape, aId: string, bId: string, mode: CombineMode): PlayedShape {
  const ai = shape.findIndex((g) => g.id === aId);
  const bi = shape.findIndex((g) => g.id === bId);
  const a = shape[ai];
  const b = shape[bi];
  if (!a || !b || ai === bi) return shape;
  const [first, second] = ai < bi ? [a, b] : [b, a];
  const turns = mode === 'sequence' ? [...first.turns, ...second.turns] : interleave(first.turns, second.turns);
  const group: PlayedGroup = { id: nextGroupId(shape), turns, mode };
  const out = shape.filter((g) => g.id !== aId && g.id !== bId);
  out.splice(Math.min(ai, bi), 0, group);
  return out;
}

function interleave(a: Turn[], b: Turn[]): Turn[] {
  const rounds = Math.max(groupRounds({ turns: a }), groupRounds({ turns: b }));
  const out: Turn[] = [];
  for (let r = 0; r < rounds; r++) {
    out.push(...a.filter((t) => t.set === r), ...b.filter((t) => t.set === r));
  }
  return out;
}

/** Back to one group per step, each step's turns in set order, in the combined group's place. */
export function split(shape: PlayedShape, groupId: string): PlayedShape {
  const i = shape.findIndex((g) => g.id === groupId);
  const group = shape[i];
  if (!group || !isCombined(group)) return shape;
  let next = nextGroupId(shape);
  const parts: PlayedGroup[] = distinctSteps(group).map((stepId) => {
    const id = next;
    next = `g${Number(next.slice(1)) + 1}`;
    return { id, turns: group.turns.filter((t) => t.stepId === stepId).sort((x, y) => x.set - y.set) };
  });
  const out = shape.slice();
  out.splice(i, 1, ...parts);
  return out;
}

/** Drag a whole group into a gap. Gaps are numbered 0..n, between the groups as they stand. */
export function moveGroup(shape: PlayedShape, groupId: string, toGap: number): PlayedShape {
  const from = shape.findIndex((g) => g.id === groupId);
  if (from < 0) return shape;
  const gap = Math.max(0, Math.min(shape.length, Math.round(toGap)));
  if (gap === from || gap === from + 1) return shape;
  const out = shape.filter((g) => g.id !== groupId);
  out.splice(gap > from ? gap - 1 : gap, 0, shape[from] as PlayedGroup);
  return out;
}

/**
 * Drag one set out of its group into a gap: it becomes a one-turn group there, and the source
 * group keeps its other turns (an emptied group is removed). Dropping a set back beside its own
 * group is not a change.
 */
export function moveTurnOut(shape: PlayedShape, groupId: string, turnIndex: number, toGap: number): PlayedShape {
  const from = shape.findIndex((g) => g.id === groupId);
  const source = shape[from];
  const turn = source?.turns[turnIndex];
  if (!source || !turn) return shape;
  if (source.turns.length === 1) return moveGroup(shape, groupId, toGap);
  const gap = Math.max(0, Math.min(shape.length, Math.round(toGap)));
  const rest: PlayedGroup = { ...source, turns: source.turns.filter((_, i) => i !== turnIndex) };
  const lifted: PlayedGroup = { id: nextGroupId(shape), turns: [turn] };
  const out = shape.slice();
  out[from] = rest;
  out.splice(gap, 0, lifted);
  return out;
}

/**
 * A shape that fits the steps it plays: turns of a step that is gone or of a set past the step's
 * count are dropped, a set the shape lost (a swap for an alternative with more sets, an older
 * snapshot) is put back after its step's last group, a step with no turns at all gets a plain
 * group at the end, and no turn appears twice. Every reader goes through this, so a stale shape
 * can never leave a set unplayable.
 */
export function normalizeShape(shape: PlayedShape, steps: readonly WalkthroughStep[]): PlayedShape {
  const counts = new Map(steps.map((s) => [s.id, setCount(s.tool)] as const));
  const seen = new Set<string>();
  const out: PlayedGroup[] = [];
  for (const g of shape) {
    const turns = g.turns.filter((t) => {
      const n = counts.get(t.stepId);
      const ok = n !== undefined && t.set >= 0 && t.set < n && !seen.has(turnKey(t));
      if (ok) seen.add(turnKey(t));
      return ok;
    });
    if (turns.length) out.push(turns.length === g.turns.length ? g : { ...g, turns });
  }
  for (const s of steps) {
    const n = setCount(s.tool);
    const missing = Array.from({ length: n }, (_, set) => ({ stepId: s.id, set })).filter(
      (t) => !seen.has(turnKey(t)),
    );
    if (!missing.length) continue;
    const last = findLastIndex(out, (g) => g.turns.some((t) => t.stepId === s.id));
    const home = out[last];
    if (home && !isCombined(home)) out[last] = { ...home, turns: [...home.turns, ...missing] };
    else out.splice(last < 0 ? out.length : last + 1, 0, { id: nextGroupId(out), turns: missing });
    for (const t of missing) seen.add(turnKey(t));
  }
  return out;
}

function findLastIndex<T>(list: T[], test: (x: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) {
    const x = list[i];
    if (x !== undefined && test(x)) return i;
  }
  return -1;
}

/** The group a step's turns sit in, by step: the steps whose sets live in more than one group. */
export function spreadSteps(shape: PlayedShape): Map<string, PlayedGroup[]> {
  const byStep = new Map<string, PlayedGroup[]>();
  for (const g of shape) {
    for (const id of distinctSteps(g)) {
      const list = byStep.get(id) ?? [];
      list.push(g);
      byStep.set(id, list);
    }
  }
  for (const [id, groups] of byStep) if (groups.length < 2) byStep.delete(id);
  return byStep;
}

/** Whether the shape is the prescription as written: every group plain, in the steps' order. */
export function isDefaultShape(shape: PlayedShape, steps: readonly WalkthroughStep[]): boolean {
  return shape.length === steps.length && shape.every((g, i) => isPlain(g, steps) && g.turns[0]?.stepId === steps[i]?.id);
}

/* ── Undo ── */

export interface ShapeHistory {
  shape: PlayedShape;
  past: PlayedShape[];
}

export function historyOf(shape: PlayedShape): ShapeHistory {
  return { shape, past: [] };
}

/** Apply a change, remembering the shape before it. A change that changed nothing is not remembered. */
export function pushShape(h: ShapeHistory, next: PlayedShape): ShapeHistory {
  return next === h.shape ? h : { shape: next, past: [...h.past, h.shape] };
}

export function undoShape(h: ShapeHistory): ShapeHistory {
  const prev = h.past[h.past.length - 1];
  return prev ? { shape: prev, past: h.past.slice(0, -1) } : h;
}

export function canUndo(h: ShapeHistory): boolean {
  return h.past.length > 0;
}
