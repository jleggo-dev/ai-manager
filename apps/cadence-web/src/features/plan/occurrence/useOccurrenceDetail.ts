import { useCallback, useEffect, useState } from 'react';
import { getOccurrenceDetail, type OccurrenceDetail } from '../../../lib/api.ts';

/**
 * `unreachable` is the server's 503 `coach_unreachable`: it tried to build the session a few
 * times and could not reach the coach. Distinct from `error` (anything else went wrong) because
 * the person is told something different and is offered a one-tap retry rather than "close and
 * tap it again". `gone` (404) is a replan having replaced the day, unchanged.
 */
export type OccurrenceSheetState = 'loading' | 'ready' | 'gone' | 'unreachable' | 'error';

/**
 * Owns occurrence detail fetch + sheet load state. A 404 means a re-plan replaced this day —
 * surface as `gone` so the sheet can say so plainly. `retry()` re-fetches in place (back through
 * `loading`), so a failed first build does not cost the person a close-and-reopen.
 */
export function useOccurrenceDetail(occurrenceId: string) {
  const [detail, setDetail] = useState<OccurrenceDetail | null>(null);
  const [state, setState] = useState<OccurrenceSheetState>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState('loading');
    getOccurrenceDetail(occurrenceId)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setState('ready');
      })
      .catch((e: Error & { status?: number; code?: string }) => {
        if (!alive) return;
        setState(e.status === 404 ? 'gone' : e.code === 'coach_unreachable' ? 'unreachable' : 'error');
      });
    return () => {
      alive = false;
    };
  }, [occurrenceId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { detail, setDetail, state, retry };
}
