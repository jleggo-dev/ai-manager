import type { WeekReviewDay, WeekReviewMeal, WeekReviewMindRow, WeekReviewSessionRow } from '../../../lib/api.ts';
import { MinutesStepper } from './MinutesStepper.tsx';

function fullDate(iso: string): string {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** A live row: a real checkbox, checked flips it. `disabled` is for the one case with nothing
 *  underneath it to write to (a meal slot outside the materialized horizon) — everything else
 *  here always has a real occurrence behind it. */
function LiveRow({
  label,
  done,
  onToggle,
  disabled,
}: {
  label: string;
  done: boolean;
  onToggle: (done: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="wkr-row">
      <input type="checkbox" checked={done} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} />
      <span className="wkr-row-label">{label}</span>
    </label>
  );
}

/** One session row: the done/skipped checkbox, plus its minutes stepper. Adjusting minutes
 *  writes `done: true` along with the value — `confirmSession` only persists minutes on a done
 *  row, so setting how long it took IS confirming it happened. */
function SessionRow({
  s,
  onToggle,
}: {
  s: WeekReviewSessionRow;
  onToggle: (occurrenceId: string, done: boolean, minutes?: number) => void;
}) {
  const minutes = s.logged_min ?? s.planned_min ?? 1;
  return (
    <div className="wkr-row wkr-row-session">
      <label className="wkr-row-check">
        <input
          type="checkbox"
          checked={s.status === 'done'}
          onChange={(e) => onToggle(s.occurrence_id, e.target.checked)}
        />
        <span className="wkr-row-label">{s.title}</span>
      </label>
      <MinutesStepper value={minutes} onChange={(next) => onToggle(s.occurrence_id, true, next)} />
    </div>
  );
}

function MindRows({
  rows,
  onToggleStep,
  onToggleSession,
}: {
  rows: WeekReviewMindRow[];
  onToggleStep: (occurrenceId: string, step: string, done: boolean) => void;
  onToggleSession: (occurrenceId: string, done: boolean) => void;
}) {
  return (
    <>
      {rows.map((row) =>
        row.steps ? (
          <div key={row.occurrence_id} className="wkr-mind-block">
            <div className="wkr-row-label">{row.title}</div>
            {row.steps.map((step) => (
              <LiveRow
                key={step.name}
                label={step.name}
                done={step.done}
                onToggle={(done) => onToggleStep(row.occurrence_id, step.name, done)}
              />
            ))}
          </div>
        ) : (
          <LiveRow
            key={row.occurrence_id}
            label={row.title}
            done={row.done === true}
            onToggle={(done) => onToggleSession(row.occurrence_id, done)}
          />
        ),
      )}
    </>
  );
}

/**
 * One day, drilled into from its DayChips ring — every session, meal slot and mind row it holds,
 * now LIVE (check-in rebuild, step 5): a session's checkbox + minutes stepper, a meal slot's
 * flip, a mind step's tick. `onBack` just clears the parent's selected date; the toggle callbacks
 * come straight from `useWeekReview` (via WeekReviewSheet) — this component never fetches or
 * holds its own copy of the facts, so what it shows is always the parent's current `facts`.
 */
export function DayDrillIn({
  day,
  onBack,
  onToggleSession,
  onToggleMeal,
  onToggleMindStep,
}: {
  day: WeekReviewDay;
  onBack: () => void;
  onToggleSession: (occurrenceId: string, done: boolean, minutes?: number) => void;
  onToggleMeal: (date: string, meal: WeekReviewMeal, logged: boolean) => void;
  onToggleMindStep: (occurrenceId: string, step: string, done: boolean) => void;
}) {
  const nothingScheduled =
    day.sessions.length === 0 && day.mind.length === 0 && day.meals.every((m) => m.occurrence_id === null);

  return (
    <div className="wkr-drillin">
      <button type="button" className="wkr-back" onClick={onBack}>
        ← Back to the week
      </button>
      <h3 className="wkr-drillin-date">{fullDate(day.date)}</h3>

      {nothingScheduled ? (
        <p className="wkr-empty">Nothing scheduled this day.</p>
      ) : (
        <>
          {day.sessions.length > 0 && (
            <div className="wkr-drillin-group">
              {day.sessions.map((s) => (
                <SessionRow key={s.occurrence_id} s={s} onToggle={onToggleSession} />
              ))}
            </div>
          )}

          <div className="wkr-drillin-group">
            {day.meals.map((m) => (
              <LiveRow
                key={m.meal}
                label={cap(m.meal)}
                done={m.logged}
                disabled={m.occurrence_id === null}
                onToggle={(logged) => onToggleMeal(day.date, m.meal, logged)}
              />
            ))}
          </div>

          {day.mind.length > 0 && (
            <div className="wkr-drillin-group">
              <MindRows
                rows={day.mind}
                onToggleStep={onToggleMindStep}
                onToggleSession={(occurrenceId, done) => onToggleSession(occurrenceId, done)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
