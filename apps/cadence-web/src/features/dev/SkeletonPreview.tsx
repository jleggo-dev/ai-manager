import { useState } from 'react';
import { PlanSkeleton } from '../plan/PlanSkeleton.tsx';
import { ProgressSkeleton } from '../progress/ProgressSkeleton.tsx';
import { MealCaptureSkeleton, SheetRowsSkeleton, WeighInSkeleton } from '../plan/SheetSkeletons.tsx';
import { FoodDay } from '../nutrition/FoodDay.tsx';

const VIEWS = ['plan', 'progress', 'meal', 'weigh', 'rows', 'food'] as const;
type View = (typeof VIEWS)[number];

/** The Food home's day, mid-flight: real structure, bars where the numbers will be. */
function FoodDayPending() {
  return (
    <FoodDay
      day={null}
      pending
      isToday
      weekDates={['2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22']}
      loggedDates={new Set()}
      hasWeek={false}
      cookbookTail=""
      confirming={null}
      onConfirm={() => {}}
      onCorrected={() => {}}
      onCoach={() => {}}
      onLog={() => {}}
      onSub={() => {}}
      onNutrients={() => {}}
      waterMl={null}
      onWater={() => {}}
    />
  );
}

/**
 * `?preview=skeletons` — every deterministic screen's placeholder, on one screen (PERF-06).
 *
 * A skeleton is the one piece of UI that is hard to review in the product: it exists for a few
 * hundred milliseconds on a good connection and, once the query cache is warm, often not at all.
 * Left unreviewable it drifts — which is how the app ended up with a single loading state
 * borrowed from the chat in the first place.
 */
export function SkeletonPreview() {
  const [view, setView] = useState<View>('plan');
  return (
    <div className="app">
      <div style={{ display: 'flex', gap: 6, padding: '10px 12px', flexWrap: 'wrap' }}>
        {VIEWS.map((v) => (
          <button
            key={v}
            className={`detour-chip ${view === v ? 'on' : ''}`}
            aria-pressed={view === v}
            onClick={() => setView(v)}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="scrollbody">
        {view === 'plan' && <PlanSkeleton />}
        {view === 'progress' && <ProgressSkeleton />}
        {view === 'meal' && <MealCaptureSkeleton />}
        {view === 'weigh' && <WeighInSkeleton />}
        {view === 'rows' && <SheetRowsSkeleton rows={3} label="Loading what's in your plan." />}
        {view === 'food' && <FoodDayPending />}
      </div>
    </div>
  );
}
