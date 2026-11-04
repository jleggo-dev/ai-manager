import { useMemo, useState } from 'react';
import {
  type PlayedShape,
  type PlayedStep,
  type Turn,
  type TurnLog,
  type TurnLogs,
  type WalkthroughStep,
  applyShape,
  defaultShape,
  normalizeShape,
  split,
  turnKey,
} from '@cadence/shared';
import { type MoveChange, type MoveChanges, applyChanges } from './changes.ts';
import type { SessionSnapshot } from './sessionInProgress.ts';

/**
 * What the person changed about the session, kept beside the prescription rather than in it
 * (walkthrough v3 Phases 5 and 6): the swaps and added weights (`changes`, changes.ts), the
 * shape they play it in (`shape`, played-shape.ts) and what each rearranged set logged
 * (`turnLogs`). The steps the shell shows are derived here from the prescription with all of
 * that applied, so the prescription is never edited and Undo is a delete.
 */
export function usePlayedSession(base: readonly WalkthroughStep[], resume?: SessionSnapshot | null) {
  const [changes, setChanges] = useState<MoveChanges>(resume?.changes ?? {});
  const prescribed = useMemo(() => applyChanges([...base], changes), [base, changes]);
  const [shape, setShapeRaw] = useState<PlayedShape>(() => resume?.shape ?? defaultShape(base));
  const [turnLogs, setTurnLogs] = useState<TurnLogs>(resume?.turnLogs ?? {});
  const groups = useMemo(() => normalizeShape(shape, prescribed), [shape, prescribed]);
  const steps: PlayedStep[] = useMemo(() => applyShape(prescribed, groups), [prescribed, groups]);
  const stepOf = (id: string) => prescribed.find((s) => s.id === id);

  const change = (key: string, patch: (c: MoveChange) => MoveChange | null) =>
    setChanges((all) => {
      const next = { ...all };
      const c = patch(all[key] ?? {});
      if (c && (c.swap || c.load)) next[key] = c;
      else delete next[key];
      return next;
    });

  const logTurn = (turn: Turn, log: TurnLog) => setTurnLogs((all) => ({ ...all, [turnKey(turn)]: log }));

  /** The index, in the steps as played, of the step holding `turn` — where to land after a rearrange. */
  const indexOfTurn = (list: PlayedStep[], turn: Turn | undefined): number => {
    if (!turn) return 0;
    const i = list.findIndex((s) => (s.play ? s.play.turns.some((t) => t.stepId === turn.stepId && t.set === turn.set) : s.id === turn.stepId));
    return Math.max(0, i);
  };

  /** The first turn of the step at `i` — what the person is on, independent of the grouping. */
  const anchorAt = (i: number): Turn | undefined => {
    const s = steps[i];
    if (!s) return undefined;
    return s.play ? s.play.turns[0] : { stepId: s.id, set: 0 };
  };

  return {
    changes,
    change,
    prescribed,
    shape: groups,
    setShape: (next: PlayedShape) => setShapeRaw(next),
    splitGroup: (groupId: string) => setShapeRaw(split(groups, groupId)),
    turnLogs,
    logTurn,
    steps,
    stepOf,
    indexOfTurn,
    anchorAt,
  };
}
