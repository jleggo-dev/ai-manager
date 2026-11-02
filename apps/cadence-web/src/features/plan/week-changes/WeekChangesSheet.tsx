import { SheetRowsSkeleton } from '../SheetSkeletons.tsx';
import { useWeekChanges } from './useWeekChanges.ts';
import { WeekChangeCard } from './WeekChangeCard.tsx';
import { WeekStrip } from './WeekStrip.tsx';
import { WeekView } from './WeekView.tsx';
import { useSheetDetent, type Detent } from './useSheetDetent.ts';
import { weekAsToggled } from './weekDays.ts';

/**
 * The Changes sheet: what the coach's pending change does, then — one drag or tap away — the week
 * it adds up to. Owner, 2026-11-01: "show the one change — allow the user to see the full week…
 * grouped by day", after a one-session swap read as "Apply 18 changes and build next week".
 *
 * Two heights. Half shows only the change (the rows that actually differ, any drop, the toggles)
 * and a quiet seven-day strip; full shows the seven days with the change applied. Reads the stored
 * pending change back — never the turn that announced it — and applies through the SAME call
 * ChangeCard's inline Apply runs: toggles persisted first, then applyPendingChange(), so the
 * commit funnel (confirmPendingPlan → resolveToggledActivities) resolves exactly what's on screen.
 * The week follows the toggles, so turning a change off shows the week without it.
 */
export function WeekChangesSheet({
  onClose,
  onApplied,
  initial = 'half',
}: {
  onClose: () => void;
  onApplied?: () => void;
  /** 'full' when the person asked for the week itself (ChangeCard's strip). */
  initial?: Detent;
}) {
  const { state, items, removed, week, enabled, toggle, enabledCount, applyState, applyError, apply } =
    useWeekChanges();
  const { detent, setDetent, handlers } = useSheetDetent(initial, onClose);
  const shown = weekAsToggled(week, enabled);
  const full = detent === 'full' && shown.length > 0;

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
      <div className={`sheet wkc-sheet${full ? ' full' : ''}`} role="dialog" aria-label="Your coach's change">
        <div className="wkc-drag" {...handlers}>
          <div className="sheet-grab" aria-hidden />
          <div className="sheet-head">
            <div className="sheet-title">
              <b>{full ? 'Your week' : 'What changes'}</b>
              <span>{full ? 'WITH THIS CHANGE' : 'SUGGESTED BY YOUR COACH'}</span>
            </div>
            <button
              className="sheet-x"
              onClick={onClose}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {state === 'loading' && <SheetRowsSkeleton rows={3} label="Loading your coach's suggestions." />}

        {state === 'unavailable' && (
          <div className="sheet-msg">Nothing to change right now — close this and take a look at your week.</div>
        )}

        {state === 'ready' && (
          <div className="sheet-body">
            {full ? (
              <WeekView week={shown} />
            ) : (
              <>
                {items.map((item) => (
                  <WeekChangeCard
                    key={item.index}
                    item={item}
                    checked={!!enabled[item.index]}
                    onToggle={() => toggle(item.index)}
                  />
                ))}
                {removed.map((title) => (
                  <div className="wkc-card" key={`removed-${title}`}>
                    <div className="wkc-card-head">
                      <b>{title}</b>
                    </div>
                    <p className="wkc-reason">Comes off your plan.</p>
                  </div>
                ))}
                <WeekStrip week={shown} onOpen={() => setDetent('full')} />
              </>
            )}
          </div>
        )}

        {state === 'ready' && (
          <div className="wkc-foot">
            {applyState === 'failed' && <div className="wkc-err">{applyError ?? 'That didn’t take — try again?'}</div>}
            <button
              type="button"
              className="cfm-build"
              onClick={() => void onApply()}
              disabled={applyState === 'applying'}
            >
              {applyState === 'applying'
                ? 'Applying…'
                : enabledCount > 0
                  ? `Apply ${enabledCount} change${enabledCount === 1 ? '' : 's'}`
                  : 'Keep my plan as it is'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
