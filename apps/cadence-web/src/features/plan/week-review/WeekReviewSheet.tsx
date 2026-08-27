import { useState } from 'react';
import { dismissPendingWeekReview } from '../../../lib/api.ts';
import { WeekReviewSkeleton } from '../SheetSkeletons.tsx';
import { useWeekReview } from './useWeekReview.ts';
import { WeeklyTasksList } from './WeeklyTasksList.tsx';
import { DayChips } from './DayChips.tsx';
import { DayDrillIn } from './DayDrillIn.tsx';
import { RollupCards } from './RollupCards.tsx';
import { diffWeekReview } from './week-review-diff.ts';
import { confirmCopy, confirmReceipt } from './confirm-copy.ts';

/** "Aug 17" — the same plain short-date shape WeekReviewCard's own header already uses. */
function shortDate(iso: string): string {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

/**
 * The week review — the full-screen sheet WeekReviewCard's "Open" mounts (check-in rebuild, step
 * 4), now with a real write-back (step 5): every toggle in `DayDrillIn`/`WeeklyTasksList` writes
 * through `useWeekReview`, and the footer button finalizes the review.
 *
 * A thin dispatcher over domain panels, same shape OccurrenceSheet.tsx already uses: this file
 * owns the sheet chrome, the load state, which day (if any) is drilled into, and the confirm
 * footer; every panel below it is a renderer of `WeekReviewFacts` plus whatever toggle callbacks
 * it needs. `useWeekReview` owns the one fetch AND every write — nothing here talks to the
 * network directly except the one dismiss call `handleConfirm` makes.
 */
export function WeekReviewSheet({
  onClose,
  onConfirmed,
}: {
  onClose: () => void;
  /** The finished review's receipt, handed to the coach VISIBLY (MainTabs' autoSend bridge) once
   *  this sheet has already closed itself. Optional so a test (or a future caller with nothing to
   *  hand off) can render this sheet without one. */
  onConfirmed?: (receiptText: string) => void;
}) {
  const { state, review, facts, initialFacts, writeError, toggleSession, toggleMeal, toggleMindStep, toggleWeighIn } =
    useWeekReview();
  const [drillDate, setDrillDate] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const drillDay = drillDate ? facts?.days.find((d) => d.date === drillDate) : undefined;

  // Diverges from `initialFacts` — the week as first fetched — as toggles land, never from the
  // last toggle itself (mirrors `diffWeekReview`'s own counting semantics; see that file's doc).
  const corrections = facts && initialFacts ? diffWeekReview(initialFacts, facts).corrections : 0;
  const { label, helper } = confirmCopy(corrections);

  /**
   * Every correction already wrote through per-toggle — this only FINALIZES: clear the pointer so
   * the card leaves the thread, close the sheet, then hand the coach the receipt visibly. A
   * failed dismiss is swallowed the same way WeekReviewCard's own "Not now" already does: the
   * pointer just stays pending server-side and the next open shows the same card again.
   */
  async function handleConfirm() {
    if (!facts || !initialFacts || confirming) return;
    setConfirming(true);
    const receipt = confirmReceipt(diffWeekReview(initialFacts, facts).summary);
    await dismissPendingWeekReview().catch(() => {});
    onClose();
    onConfirmed?.(receipt);
  }

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet wkr-sheet" role="dialog" aria-label="Week review">
        <div className="sheet-grab" aria-hidden />
        <div className="sheet-head">
          <div className="sheet-title">
            <b>Week review</b>
            {review && (
              <span>
                {shortDate(review.from)}–{shortDate(review.to)}
              </span>
            )}
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {state === 'loading' && <WeekReviewSkeleton />}

        {state === 'unavailable' && (
          <div className="sheet-msg">Nothing to review right now — close this and take a look at your week.</div>
        )}

        {state === 'ready' && facts && (
          <>
            <div className="sheet-body">
              {drillDay ? (
                <DayDrillIn
                  day={drillDay}
                  onBack={() => setDrillDate(null)}
                  onToggleSession={toggleSession}
                  onToggleMeal={toggleMeal}
                  onToggleMindStep={toggleMindStep}
                />
              ) : (
                <>
                  <WeeklyTasksList facts={facts} onToggleWeighIn={toggleWeighIn} />
                  <h3 className="wkr-section-label">DAY BY DAY</h3>
                  <p className="wkr-helper">Tap a day to check or fix its log</p>
                  <DayChips days={facts.days} onSelect={setDrillDate} />
                  <RollupCards facts={facts} />
                </>
              )}
            </div>

            {writeError && <div className="wkr-write-err">{writeError}</div>}

            <div className="wkr-confirm-foot">
              <button
                type="button"
                className="wkr-confirm-btn"
                disabled={confirming}
                onClick={() => void handleConfirm()}
              >
                {confirming ? 'Confirming…' : label}
              </button>
              <p className="wkr-confirm-helper">{helper}</p>
            </div>
          </>
        )}
      </div>
    </>
  );
}
