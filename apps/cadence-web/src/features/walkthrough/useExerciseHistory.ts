import { useQuery } from '@tanstack/react-query';
import type { ExerciseHistoryLine } from '@cadence/shared';
import { getExerciseHistory } from '../../lib/api.ts';
import { queryKeys } from '../../lib/query/keys.ts';

/**
 * The last time one exercise was logged, for the Change sheet (walkthrough v3 Phase 5b). From the
 * shared query cache like every other read, so reopening the sheet paints at once. A failed read
 * THROWS (the query stays in error, `data` undefined) rather than reading as "never done": New is
 * drawn only from an answered empty list.
 */
export function useLastLogged(activity: string, exercise: string, enabled = true) {
  return useQuery<ExerciseHistoryLine | null>({
    queryKey: queryKeys.exerciseHistory.last(activity, exercise),
    queryFn: async () => {
      const r = await getExerciseHistory({ exercise, activity, limit: 1 });
      if (!r.ok) throw new Error('exercise history unavailable');
      return r.lines[0] ?? null;
    },
    enabled: enabled && exercise.trim().length > 0,
    staleTime: 10 * 60_000,
  });
}
