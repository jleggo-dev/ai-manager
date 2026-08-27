import type { WeekReviewFacts } from '../../../lib/api.ts';

/** "Sat, Aug 23" — same plain short-date shape ConfirmCard/WeekReviewCard already use. */
function shortDate(iso: string): string {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

/**
 * The week's own one-off tasks — today just the weigh-in (`WeekReviewFacts.weigh_in`), which
 * rides on the facts payload beside `days` rather than inside one of them because it is
 * scheduled once for the week, not once per day. Read-only this step: the mark is inert, not a
 * button — corrections are a later slice (DESIGN-check-in.md item 5).
 *
 * A week with no weigh-in scheduled shows nothing here, not an empty placeholder row — there is
 * nothing to confirm, so there is nothing to draw (BRAND.md: count what happened).
 */
export function WeeklyTasksList({ facts }: { facts: WeekReviewFacts }) {
  const { weigh_in } = facts;
  return (
    <section aria-label="Weekly tasks">
      <h3 className="wkr-section-label">WEEKLY TASKS</h3>
      {weigh_in ? (
        <div className="wkr-task-row">
          <span className={`wkr-task-mark${weigh_in.status === 'done' ? ' is-done' : ''}`} aria-hidden>
            {weigh_in.status === 'done' ? '✓' : ''}
          </span>
          <span className="wkr-task-label">Weigh-in</span>
          <span className="wkr-task-date">{shortDate(weigh_in.date)}</span>
        </div>
      ) : (
        <p className="wkr-empty">No weigh-in on the books this week.</p>
      )}
    </section>
  );
}
