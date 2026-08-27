import type { WeekReviewDay, WeekReviewMindRow } from '../../../lib/api.ts';

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

/**
 * One inert row — read-only this step (DESIGN-check-in.md's corrections-on-the-card are a later
 * slice; this one only shows what happened). A real `<input type="checkbox">`, disabled, so the
 * shape a future correction lands into already exists — the tap just isn't wired to anything yet.
 */
function InertRow({ label, done, sub }: { label: string; done: boolean; sub?: string }) {
  return (
    <label className="wkr-row">
      <input type="checkbox" checked={done} disabled readOnly />
      <span className="wkr-row-label">{label}</span>
      {sub && <span className="wkr-row-sub">{sub}</span>}
    </label>
  );
}

function MindRows({ rows }: { rows: WeekReviewMindRow[] }) {
  return (
    <>
      {rows.map((row) =>
        row.steps ? (
          <div key={row.occurrence_id} className="wkr-mind-block">
            <div className="wkr-row-label">{row.title}</div>
            {row.steps.map((step) => (
              <InertRow key={step.name} label={step.name} done={step.done} />
            ))}
          </div>
        ) : (
          <InertRow key={row.occurrence_id} label={row.title} done={row.done === true} />
        ),
      )}
    </>
  );
}

/**
 * One day, drilled into from its DayChips ring — every session, meal slot and mind row it holds.
 * Client-side only: `onBack` just clears the parent's selected date, nothing here fetches or
 * mutates (read-only this step).
 */
export function DayDrillIn({ day, onBack }: { day: WeekReviewDay; onBack: () => void }) {
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
                <InertRow
                  key={s.occurrence_id}
                  label={s.title}
                  done={s.status === 'done'}
                  sub={
                    s.logged_min != null
                      ? `${s.logged_min} min`
                      : s.planned_min != null
                        ? `${s.planned_min} min planned`
                        : undefined
                  }
                />
              ))}
            </div>
          )}

          <div className="wkr-drillin-group">
            {day.meals.map((m) => (
              <InertRow key={m.meal} label={cap(m.meal)} done={m.logged} />
            ))}
          </div>

          {day.mind.length > 0 && (
            <div className="wkr-drillin-group">
              <MindRows rows={day.mind} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
