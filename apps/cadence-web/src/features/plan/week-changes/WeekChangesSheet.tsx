import { SheetRowsSkeleton } from '../SheetSkeletons.tsx';
import { useWeekChanges } from './useWeekChanges.ts';
import { WeekChangeCard } from './WeekChangeCard.tsx';

/**
 * The Changes sheet (check-in rebuild, step 7 — client half): the swap candidates the coach
 * persisted the moment she offered them, via propose_plan_change's `reason`/`optional` fields
 * (coach-actions.ts, plan-edit.ts). Reads the stored pending change back — never the turn that
 * announced it — lets the user flip any card's toggle, then applies through the SAME lock flow
 * ChangeCard's own inline Apply already runs: toggles persisted first, then lockPlan(), so the
 * commit funnel (confirmPendingPlan → resolveToggledActivities) resolves exactly what's on screen.
 *
 * A pure DB read, same as WeekReviewSheet — SheetRowsSkeleton, not chat dots.
 */
export function WeekChangesSheet({ onClose, onApplied }: { onClose: () => void; onApplied?: () => void }) {
  const { state, planVersion, items, enabled, toggle, enabledCount, applyState, apply } = useWeekChanges();

  async function onApply() {
    const ok = await apply();
    if (ok) {
      onApplied?.();
      onClose();
    }
  }

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet wkc-sheet" role="dialog" aria-label="Changes for next week">
        <div className="sheet-grab" aria-hidden />
        <div className="sheet-head">
          <div className="sheet-title">
            <b>Changes for next week</b>
            {planVersion != null && <span>WEEK {planVersion + 1} · SUGGESTED BY YOUR COACH</span>}
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {state === 'loading' && <SheetRowsSkeleton rows={3} label="Loading your coach's suggestions." />}

        {state === 'unavailable' && (
          <div className="sheet-msg">Nothing to change right now — close this and take a look at your week.</div>
        )}

        {state === 'ready' && (
          <div className="sheet-body">
            {items.map((item) => (
              <WeekChangeCard
                key={item.index}
                item={item}
                checked={!!enabled[item.index]}
                onToggle={() => toggle(item.index)}
              />
            ))}
            <p className="wkc-helper">Nothing changes until you tap this.</p>
            {applyState === 'failed' && <div className="wkc-err">That didn&rsquo;t take — try again?</div>}
            <button
              type="button"
              className="cfm-build"
              onClick={() => void onApply()}
              disabled={applyState === 'applying'}
            >
              {applyState === 'applying'
                ? 'Applying…'
                : enabledCount > 0
                  ? `Apply ${enabledCount} change${enabledCount === 1 ? '' : 's'} and build next week`
                  : 'Build next week with no changes'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
