import { useEffect, useState } from 'react';
import type { PendingWeekReview } from '@cadence/shared';
import {
  confirmWeekReviewSession,
  getWeekReviewFacts,
  toggleWeekReviewMeal,
  toggleWeekReviewMindStep,
  type WeekReviewFacts,
  type WeekReviewMeal,
} from '../../../lib/api.ts';
import { applyMealToggle, applyMindStepToggle, applySessionToggle, applyWeighInToggle } from './week-review-mutate.ts';

export type WeekReviewLoadState = 'loading' | 'ready' | 'unavailable';

/** Same quiet copy the app already used for a write that didn't land, pre check-in-rebuild — no
 *  toast system exists, so a small text line in the sheet is right. */
const SAVE_FAILED = "That didn't save — try again in a moment.";

/**
 * The week review's data: one fetch on mount (as before), plus the toggles that correct it
 * (check-in rebuild, step 5).
 *
 * `facts` is what the sheet renders and mutates optimistically; `initialFacts` is frozen at the
 * moment the review opened and never touched again, so `diffWeekReview(initialFacts, facts)`
 * always compares against what was actually LOGGED before this session — never against the
 * user's own last toggle (which would make every toggle "0 corrections from itself").
 *
 * Each toggle applies its pure `week-review-mutate.ts` update to `facts` immediately, fires the
 * matching write behind it, and reverts + sets `writeError` if the write comes back false or
 * throws. The write already IS the save — "Confirm my week" (WeekReviewSheet) only finalizes and
 * never re-writes.
 */
export function useWeekReview() {
  const [state, setState] = useState<WeekReviewLoadState>('loading');
  const [review, setReview] = useState<PendingWeekReview | null>(null);
  const [facts, setFacts] = useState<WeekReviewFacts | null>(null);
  const [initialFacts, setInitialFacts] = useState<WeekReviewFacts | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

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
        setInitialFacts(r.facts);
        setState('ready');
      })
      .catch(() => {
        if (alive) setState('unavailable');
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Apply `next` now, fire the write, and put `prev` back (with a quiet error line) on failure. */
  async function commit(prev: WeekReviewFacts, next: WeekReviewFacts, write: () => Promise<boolean>): Promise<void> {
    setWriteError(null);
    setFacts(next);
    try {
      if (await write()) return;
    } catch {
      /* falls through to the same revert a false return gets */
    }
    setFacts(prev);
    setWriteError(SAVE_FAILED);
  }

  async function toggleSession(occurrenceId: string, done: boolean, minutes?: number): Promise<void> {
    if (!facts) return;
    await commit(facts, applySessionToggle(facts, occurrenceId, done, minutes), () =>
      confirmWeekReviewSession(occurrenceId, done, minutes),
    );
  }

  async function toggleMeal(date: string, meal: WeekReviewMeal, logged: boolean): Promise<void> {
    if (!facts) return;
    await commit(facts, applyMealToggle(facts, date, meal, logged), () => toggleWeekReviewMeal(date, meal, logged));
  }

  async function toggleMindStep(occurrenceId: string, step: string, done: boolean): Promise<void> {
    if (!facts) return;
    await commit(facts, applyMindStepToggle(facts, occurrenceId, step, done), () =>
      toggleWeekReviewMindStep(occurrenceId, step, done),
    );
  }

  /** The week's weigh-in row (WeeklyTasksList) — same write as any session, just without minutes;
   *  toggling it done without an actual weight is status only, and that's fine (it never enters
   *  the "correction" count `diffWeekReview` reads — see that file's own note). */
  async function toggleWeighIn(done: boolean): Promise<void> {
    const weighIn = facts?.weigh_in;
    if (!facts || !weighIn) return;
    await commit(facts, applyWeighInToggle(facts, done), () => confirmWeekReviewSession(weighIn.occurrence_id, done));
  }

  return { state, review, facts, initialFacts, writeError, toggleSession, toggleMeal, toggleMindStep, toggleWeighIn };
}
