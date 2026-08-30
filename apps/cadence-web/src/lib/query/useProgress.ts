import { useQuery } from '@tanstack/react-query';
import type { ProgressWindow } from '@cadence/shared';
import { getProgress } from '../api.ts';
import { queryKeys } from './keys.ts';

/** The dashboard shape the API returns — the api fn owns it; infer rather than re-declare. */
type ProgressData = Awaited<ReturnType<typeof getProgress>>;

/**
 * The shared `/progress` query (PERF-01): same contract as usePlan — a tab return paints from
 * cache instantly (revalidating in the background once stale), and the typing dots are reserved
 * for the first load of a session. `getProgress` already throws on a non-OK response, so a blip
 * keeps the last good dashboard on screen instead of blanking it.
 *
 * `window` omitted keeps today's exact behavior — same key (`queryKeys.progress.all`), same
 * unwindowed fetch — so every existing caller (ProgressView) is untouched. Passing a window uses
 * its OWN cache entry (`queryKeys.progress.window`) so switching Week/Month/All doesn't thrash a
 * single shared key; plumbing only — no caller passes this yet (integration parcel wires it up).
 */
export function useProgress(window?: ProgressWindow) {
  return useQuery<ProgressData>({
    queryKey: window ? queryKeys.progress.window(window) : queryKeys.progress.all,
    queryFn: () => getProgress(window),
  });
}
