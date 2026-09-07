import { useMemo } from 'react';
import { deriveWalkthrough } from '@cadence/shared';
import type { PlanDay, PlanOccurrence } from '../../../lib/api.ts';
import { formatClock } from '../../../lib/clock.ts';
import { useClockUnit } from '../../../lib/query/index.ts';
import { useOccurrenceDetail } from '../occurrence/useOccurrenceDetail.ts';
import { usePlannedMeal } from '../occurrence/usePlannedMeal.ts';
import { mealFromTitle } from '../occurrence/format.ts';
import { taskOpener } from '../taskShape.ts';
import { dayName } from './holdMenuModel.ts';

/**
 * A future task, tapped (owner, 2026-09-07): a look, not a start. People tap ahead to see what is
 * coming, so a dead tap would read as broken — but a future session must not be startable from
 * here, or "today" stops meaning anything on the trail. The one door is "Do it now?", which
 * leads to the same move-to-today ask the hold menu owns.
 *
 * Opening a session's preview also asks the server for its detail, which is what writes the
 * session on first open — so a look ahead warms the 30-60s write for free, and the day it comes
 * round the sheet opens instantly.
 */
export function PreviewSheet({
  occ,
  date,
  todayIso,
  week,
  onClose,
  onDoNow,
}: {
  occ: PlanOccurrence;
  date: string;
  todayIso: string;
  week: readonly PlanDay[];
  onClose: () => void;
  /** The one door. Absent when the row is already done — there is nothing to do now. */
  onDoNow?: () => void;
}) {
  const clock = useClockUnit();
  const when = formatClock(occ.time_of_day, clock);
  const shape = taskOpener(occ);
  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet hm pv" role="dialog" aria-label={`${occ.title} — preview`}>
        <div className="sheet-grab" aria-hidden />
        <div className="hm-h">
          <b>{occ.title}</b>
          <span>
            {dayName(date, week, todayIso)}
            {when ? ` · at ${when}` : ''}
          </span>
        </div>

        {shape === 'task' && <SessionPreview occurrenceId={occ.occurrence_id} />}
        {shape === 'meal' && <MealPreview title={occ.title} date={date} />}
        {shape === 'weigh' && <p className="pv-note">A quick step on the scale, when the day comes.</p>}
        {shape === 'cook' && <p className="pv-note">The recipe walkthrough opens on the day.</p>}
        {shape === 'shop' && <p className="pv-note">The shopping list is ready whenever you are.</p>}

        {onDoNow && (
          <button className="ss-btn ss-start" onClick={onDoNow}>
            Do it now?
          </button>
        )}
        <button className="adhoc-cancel" onClick={onClose}>
          Not yet
        </button>
      </div>
    </>
  );
}

/** The session's steps, as written — or an honest wait while they are being written. */
function SessionPreview({ occurrenceId }: { occurrenceId: string }) {
  const { detail, state } = useOccurrenceDetail(occurrenceId);
  const wt = useMemo(() => (detail?.session ? deriveWalkthrough(detail.session) : null), [detail]);

  if (state === 'loading') {
    return (
      <div className="sheet-loading">
        <span className="typing">
          <i />
          <i />
          <i />
        </span>
        <span className="sheet-loading-t">Sketching this one out…</span>
      </div>
    );
  }
  if (state === 'gone') return <p className="pv-note">This one moved with your new plan.</p>;
  if (!wt) return <p className="pv-note">{"I'll write this one up closer to the day."}</p>;
  return (
    <>
      <p className="pv-note">
        {wt.total_min} min, as planned{detail?.why ? ` — ${detail.why}` : '.'}
      </p>
      <div className="ss-steps">
        {wt.steps.map((s) => (
          <div className="ss-step" key={s.id}>
            <span className="ss-dot" aria-hidden />
            <span className="ss-step-t">{s.title}</span>
            <span className="ss-step-m">{s.minutes} min</span>
          </div>
        ))}
      </div>
    </>
  );
}

/** What the week's menu has planned for this slot — or plainly nothing, never a guess. */
function MealPreview({ title, date }: { title: string; date: string }) {
  const { planned } = usePlannedMeal(mealFromTitle(title) ?? 'breakfast', date);
  return (
    <p className="pv-note">{planned ? `On the menu: ${planned.name}.` : 'Nothing on the menu for this one yet.'}</p>
  );
}
