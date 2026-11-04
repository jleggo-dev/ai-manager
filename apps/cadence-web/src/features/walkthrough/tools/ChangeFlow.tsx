import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { ExerciseHistoryLine, SessionItemAlternative, StepTool } from '@cadence/shared';
import { askAlternativeItem, getExerciseHistory } from '../../../lib/api.ts';
import { queryKeys } from '../../../lib/query/keys.ts';
import { useUnits } from '../../../lib/query/useUnits.ts';
import { dialStart, swapRows, takesLoad } from '../changes.ts';
import { useLastLogged } from '../useExerciseHistory.ts';
import { ChangeSheet, type AskState } from './ChangeSheet.tsx';
import { WeightSheet } from './WeightSheet.tsx';

/**
 * The Change flow for ONE move: the Change sheet, then the weight control it opens (or the weight
 * control straight away, from the quiet Change weight button). Mounted only while open, so this is
 * where the reads live — the display units, each row's last logged line, the ask to the coach — and
 * the shell stays a shell. Everything it hands back is one fact: a swap picked, a load chosen, closed.
 */
export interface ChangeTarget {
  /** The move as it is being played: its name and tool (after any earlier swap). */
  name: string;
  tool: StepTool;
  /** The prescribed move's alternatives, which stay the list even after a swap. */
  alternatives?: SessionItemAlternative[];
  suggested_load?: string;
  /** The load in effect now, when the person already added one. */
  workingLoad?: string;
  /** The activity this session belongs to, for history and the ask. */
  activity: string;
  /** The sheet's second line, "GLUTE BRIDGE · SET 1 OF 2 NEXT". */
  subtitle: string;
  /** The move's own number for the weight sheet's subtitle ("12 reps", "45 s"). */
  targetWord: string;
}

export function ChangeFlow({
  target,
  start,
  onSwap,
  onUseLoad,
  onClose,
}: {
  target: ChangeTarget;
  start: 'change' | 'weight';
  onSwap: (alt: SessionItemAlternative) => void;
  onUseLoad: (load: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'change' | 'weight'>(start);
  const [landed, setLanded] = useState<SessionItemAlternative[]>([]);
  const [ask, setAsk] = useState<AskState>({ kind: 'idle' });
  const units = useUnits();
  const unit = units.data?.resolved?.body_weight === 'kg' ? 'kg' : 'lb';

  const rows = swapRows(target.alternatives, target.name, landed);
  const histories = useQueries({
    queries: rows.map((alt) => ({
      queryKey: queryKeys.exerciseHistory.last(target.activity, alt.name),
      queryFn: async (): Promise<ExerciseHistoryLine | null> => {
        const r = await getExerciseHistory({ exercise: alt.name, activity: target.activity, limit: 1 });
        if (!r.ok) throw new Error('exercise history unavailable');
        return r.lines[0] ?? null;
      },
      staleTime: 10 * 60_000,
    })),
  });
  const history: Record<string, ExerciseHistoryLine | null | undefined> = {};
  rows.forEach((alt, i) => {
    const q = histories[i];
    history[alt.name] = q?.isError ? undefined : q?.data;
  });
  const own = useLastLogged(target.activity, target.name);

  async function somethingElse() {
    setAsk({ kind: 'asking' });
    const t = target.tool;
    const item = {
      name: target.name,
      ...(t.kind === 'reps' ? { sets: t.sets, reps: t.reps, load: t.load } : {}),
      ...(t.kind === 'timer' ? { sets: t.sets, duration_min: t.seconds / 60, load: t.load } : {}),
    };
    const r = await askAlternativeItem({
      activity: target.activity,
      item,
      alreadyOffered: [...rows.map((a) => a.name), ...(target.alternatives?.map((a) => a.name) ?? [])],
    });
    if (r.ok) {
      setLanded((l) => [...l, r.alternative]);
      setAsk({ kind: 'idle' });
    } else setAsk({ kind: 'fault' });
  }

  if (mode === 'weight') {
    return (
      <WeightSheet
        title={target.workingLoad ? 'Change weight' : 'Add weight'}
        name={target.name}
        targetWord={target.targetWord}
        unit={unit}
        start={dialStart(
          target.workingLoad,
          'load' in target.tool ? target.tool.load : undefined,
          target.suggested_load,
        )}
        suggested={target.suggested_load}
        last={own.data?.load ? { load: own.data.load, date: own.data.date } : undefined}
        onUse={onUseLoad}
        onBack={start === 'weight' ? onClose : () => setMode('change')}
      />
    );
  }
  return (
    <ChangeSheet
      subtitle={target.subtitle}
      canAddWeight={takesLoad(target.tool)}
      hasWeight={!!target.workingLoad}
      rows={rows}
      history={history}
      ask={ask}
      onAddWeight={() => setMode('weight')}
      onSwap={onSwap}
      onSomethingElse={() => void somethingElse()}
      onClose={onClose}
    />
  );
}
