/**
 * B3 — the on-the-spot offer (MEAL-LOGGING.md: "Save-as comes after the meal exists. The
 * on-the-spot offer appears after several quick adds… a preview of the bracket, not a dialog.
 * Declining is free; the Sunday sweep is the fallback.").
 *
 * The trigger is deliberately narrow: at least four appends inside ~ninety seconds, all landing
 * as loose items in a meal with no parts yet. Declining dismisses for THIS draft, permanently —
 * the set below outlives a remount so a declined offer never comes back on the same window.
 */
import { useCallback, useRef, useState } from 'react';
import type { Meal } from '../../../lib/api/meal-draft.ts';

export const OFFER_MIN_ADDS = 4;
export const OFFER_WINDOW_MS = 90_000;

/** Drafts whose offer was declined — never re-offer this draft; Sunday is the fallback. */
const declined = new Set<string>();

export function useGroupOffer() {
  const stamps = useRef<{ logId: string | null; times: number[] }>({ logId: null, times: [] });
  const [, bump] = useState(0);

  /** Call after every successful append into the draft. */
  const recordAppend = useCallback((logId: string) => {
    const s = stamps.current;
    if (s.logId !== logId) {
      s.logId = logId;
      s.times = [];
    }
    s.times.push(Date.now());
    bump((n) => n + 1);
  }, []);

  const decline = useCallback((logId: string) => {
    declined.add(logId);
    bump((n) => n + 1);
  }, []);

  const shouldOffer = useCallback((meal: Meal | null): boolean => {
    if (!meal || declined.has(meal.log_id)) return false;
    if ((meal.parts ?? []).length > 0) return false;
    if (meal.items.length < OFFER_MIN_ADDS) return false;
    const s = stamps.current;
    if (s.logId !== meal.log_id || s.times.length < OFFER_MIN_ADDS) return false;
    const lastFour = s.times.slice(-OFFER_MIN_ADDS);
    return lastFour[lastFour.length - 1]! - lastFour[0]! <= OFFER_WINDOW_MS;
  }, []);

  return { recordAppend, decline, shouldOffer };
}

/** Test seam: forget every declined draft. */
export function resetGroupOffers(): void {
  declined.clear();
}
