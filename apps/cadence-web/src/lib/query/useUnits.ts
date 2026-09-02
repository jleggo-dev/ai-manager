import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClockUnit } from '@cadence/shared';
import { getUnits, type UnitsResponse } from '../api.ts';
import { asClockUnit } from '../clock.ts';
import { queryKeys } from './keys.ts';

/**
 * The resolved display units, shared. Settings writes them; the trail, the occurrence rows, the
 * quiet-hours chip and the proposed week all read the clock from here, so a tap in Settings
 * changes every time on screen at once — the same one-key rule `useNotificationPrefs` follows.
 * Long `staleTime`: units change when the user changes them, and the writer invalidates.
 */
export function useUnits() {
  return useQuery<UnitsResponse | null>({
    queryKey: queryKeys.units.all,
    queryFn: getUnits,
    staleTime: 10 * 60_000,
  });
}

/** Sunrise default is 24-hour: it is what every stored time already reads as, and the trail has
 *  always shown it — a screen must never flip dialect while the preference is still loading. */
export function useClockUnit(): ClockUnit {
  const { data } = useUnits();
  return asClockUnit(data?.resolved?.clock) ?? '24h';
}

/** After a units write: drop the cached answer so every reader picks up the new one. */
export function useInvalidateUnits() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.units.all });
}
