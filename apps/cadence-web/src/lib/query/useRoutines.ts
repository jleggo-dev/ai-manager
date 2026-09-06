/**
 * `/me/routines` — the activities they've built, through the cache.
 *
 * Two surfaces read this (Settings' "Your activities" door, quick-add's per-area shelf) and both
 * used to fetch it on mount and forget it on unmount, so the list appeared a round trip after the
 * screen did, every time.
 *
 * A failed read THROWS rather than resolving to `null`. `listUserRoutines` soft-fails by design —
 * "I could not read" and "you have none" are different answers and the API refuses to conflate
 * them — but a resolved `null` would be cached as data, painted as an empty shelf, and written to
 * the boot snapshot as if the person had built nothing. Throwing keeps the last good answer on
 * screen and leaves the retry to react-query.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listUserRoutines, type UserRoutine } from '../api.ts';
import { queryKeys } from './keys.ts';

export function useRoutines() {
  return useQuery<UserRoutine[]>({
    queryKey: queryKeys.routines.all,
    queryFn: async () => {
      const rows = await listUserRoutines();
      if (!rows) throw new Error('routines-unavailable');
      return rows;
    },
    staleTime: 5 * 60_000,
  });
}

/** Write a routine list back after a rename, a delete, a schedule change or a run. */
export function useUpdateRoutines() {
  const queryClient = useQueryClient();
  return (patch: (routines: UserRoutine[]) => UserRoutine[]) =>
    queryClient.setQueryData<UserRoutine[]>(queryKeys.routines.all, (prev) => (prev ? patch(prev) : prev));
}
