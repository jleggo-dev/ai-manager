import { useQuery } from '@tanstack/react-query';
import { getDatedSessions, type DatedSessionsListResult } from '../api.ts';
import { queryKeys } from './keys.ts';
import type { ProgressWindow } from '@cadence/shared';

/**
 * The `dated_sessions` widget's binding query (W1-3) — also what SessionListScreen's drill-down
 * reads. `activity` is the plan's cross-plan history key (the activity TITLE); an empty string
 * disables the query since the endpoint has nothing to bind without one.
 */
export function useDatedSessions(activity: string, window: ProgressWindow = 'all') {
  return useQuery<DatedSessionsListResult>({
    queryKey: queryKeys.datedSessions.scoped(activity, window),
    queryFn: () => getDatedSessions(activity, window),
    enabled: activity.length > 0,
  });
}
