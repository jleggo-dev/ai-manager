import { useEffect, useState } from 'react';
import { getOccurrenceDetail, type OccurrenceDetail } from '../../../lib/api.ts';

export type OccurrenceSheetState = 'loading' | 'ready' | 'gone' | 'error';

/**
 * Owns occurrence detail fetch + sheet load state. A 404 means a re-plan replaced this day —
 * surface as `gone` so the sheet can say so plainly.
 */
export function useOccurrenceDetail(occurrenceId: string) {
  const [detail, setDetail] = useState<OccurrenceDetail | null>(null);
  const [state, setState] = useState<OccurrenceSheetState>('loading');

  useEffect(() => {
    let alive = true;
    getOccurrenceDetail(occurrenceId)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setState('ready');
      })
      .catch((e: Error & { status?: number }) => {
        if (!alive) return;
        setState(e.status === 404 ? 'gone' : 'error');
      });
    return () => {
      alive = false;
    };
  }, [occurrenceId]);

  return { detail, setDetail, state };
}
