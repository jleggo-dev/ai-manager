import { useEffect, useState } from 'react';
import type { PendingWeekReview } from '@cadence/shared';
import { getWeekReviewFacts, type WeekReviewFacts } from '../../../lib/api.ts';

export type WeekReviewLoadState = 'loading' | 'ready' | 'unavailable';

/**
 * The review sheet's one read: `getWeekReviewFacts` on mount, nothing else — the whole facts
 * payload is a single deterministic GET (DESIGN-check-in.md: "the week's numbers ... are computed
 * and instant"), so there is no polling, no refetch-on-focus, no cache to invalidate here.
 *
 * `unavailable` covers every reason there's nothing to show (nothing pending, dismissed on
 * another device meanwhile, a server hiccup) with one warm fallback rather than a diagnosis — same
 * collapse `getPendingChange`/`getPlan` already make for their own callers.
 */
export function useWeekReview() {
  const [state, setState] = useState<WeekReviewLoadState>('loading');
  const [review, setReview] = useState<PendingWeekReview | null>(null);
  const [facts, setFacts] = useState<WeekReviewFacts | null>(null);

  useEffect(() => {
    let alive = true;
    setState('loading');
    void getWeekReviewFacts()
      .then((r) => {
        if (!alive) return;
        if (!r) {
          setState('unavailable');
          return;
        }
        setReview(r.review);
        setFacts(r.facts);
        setState('ready');
      })
      .catch(() => {
        if (alive) setState('unavailable');
      });
    return () => {
      alive = false;
    };
  }, []);

  return { state, review, facts };
}
