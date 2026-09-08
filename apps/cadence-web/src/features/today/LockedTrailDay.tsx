import type { PlanDay } from '../../lib/api.ts';

/**
 * A day behind the wall (trailLock.ts): the horizon stays visible — the owner is fine seeing
 * it — but nothing on it is pressable. What was planned is listed as plain text so the person
 * can see the shape of the week the check-in will confirm or redraw; there are no discs, no
 * rings, no bay, and deliberately no "A clear day" line, which would read as a verdict on a day
 * nobody has reached yet. One quiet line says why.
 */
export const LOCKED_DAY_LINE = 'After your check-in';

export function LockedTrailDay({ day }: { day: PlanDay }) {
  return (
    <div className="trail-locked" aria-disabled="true">
      <p className="trail-locked-line">{LOCKED_DAY_LINE}</p>
      {day.occurrences.length > 0 && (
        <ul className="trail-locked-list">
          {day.occurrences.map((o) => (
            <li key={o.occurrence_id} className="trail-locked-title">
              {o.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
