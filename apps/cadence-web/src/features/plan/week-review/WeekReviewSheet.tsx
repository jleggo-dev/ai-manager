import { useState } from 'react';
import { WeekReviewSkeleton } from '../SheetSkeletons.tsx';
import { useWeekReview } from './useWeekReview.ts';
import { WeeklyTasksList } from './WeeklyTasksList.tsx';
import { DayChips } from './DayChips.tsx';
import { DayDrillIn } from './DayDrillIn.tsx';
import { RollupCards } from './RollupCards.tsx';

/** "Aug 17" — the same plain short-date shape WeekReviewCard's own header already uses. */
function shortDate(iso: string): string {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

/**
 * The week review — the full-screen sheet WeekReviewCard's "Open" mounts, and the real screen
 * MainTabs' `weekReviewOpen` placeholder stood in for (check-in rebuild, step 4). Read-only this
 * step: everything renders, a day chip drills in, but nothing here mutates — DESIGN-check-in.md's
 * corrections-on-the-card are a later slice.
 *
 * A thin dispatcher over domain panels, same shape OccurrenceSheet.tsx already uses: this file
 * owns the sheet chrome, the load state, and which day (if any) is drilled into; every panel below
 * it is a pure renderer of `WeekReviewFacts`. `useWeekReview` owns the one fetch; nothing here
 * knows how the data arrived.
 */
export function WeekReviewSheet({ onClose }: { onClose: () => void }) {
  const { state, review, facts } = useWeekReview();
  const [drillDate, setDrillDate] = useState<string | null>(null);
  const drillDay = drillDate ? facts?.days.find((d) => d.date === drillDate) : undefined;

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
          <div className="sheet-body">
            {drillDay ? (
              <DayDrillIn day={drillDay} onBack={() => setDrillDate(null)} />
            ) : (
              <>
                <WeeklyTasksList facts={facts} />
                <h3 className="wkr-section-label">DAY BY DAY</h3>
                <p className="wkr-helper">Tap a day to check or fix its log</p>
                <DayChips days={facts.days} onSelect={setDrillDate} />
                <RollupCards facts={facts} />
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
