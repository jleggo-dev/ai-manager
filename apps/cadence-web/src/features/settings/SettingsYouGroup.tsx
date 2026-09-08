import type { ReviewData, UserConstraint } from '../../lib/api.ts';
import { SettingsConstraintsRow } from './SettingsConstraintsRow.tsx';

/**
 * "YOU & YOUR COACH" (design owner-approved 2026-08-31). `review` is fetched once by
 * `SettingsRoom` (the same `getReview()` call `WeighInSettings` already uses) and
 * handed down here so the goal count and the sub-screens' underlying data can never
 * disagree about what is "on the plan" right now.
 *
 * Labels only (owner, 2026-09-07: "we have way too much text in this app"). The one sub-line
 * left is the goals count — a live value, not a description of what the door does.
 *
 * Goals and equipment are DOORS (SR-4/SR-5, other Settings Room parcels); constraints are a
 * read-only row (SR-3's own — see `SettingsConstraintsRow`).
 */
export function SettingsYouGroup({
  review,
  constraints,
  onOpenGoals,
  onOpenActivities,
  onOpenTools,
  onOpenNutrition,
}: {
  review: ReviewData | null;
  constraints: UserConstraint[] | null;
  onOpenGoals: () => void;
  /** Activity Builder wave 3 (SR beside SR-4's goals door): "Your activities" — manage what
   *  you've built. */
  onOpenActivities: () => void;
  onOpenTools: () => void;
  onOpenNutrition: () => void;
}) {
  // "On the plan" excludes only abandoned goals — captured/confirmed/committed/parked/completed
  // are all still something a person might come here to rename or retire.
  const onPlan = review ? review.goals.filter((g) => g.status !== 'abandoned').length : null;

  return (
    <section className="room-group">
      <h3 className="room-group-label">You & your coach</h3>
      <button type="button" className="room-row" onClick={onOpenGoals}>
        <span className="room-row-text">
          <b>Your goals</b>
          {onPlan != null && <span>{`${onPlan} on the plan`}</span>}
        </span>
        <i className="room-chevron" aria-hidden>
          ›
        </i>
      </button>
      <button type="button" className="room-row" onClick={onOpenActivities}>
        <span className="room-row-text">
          <b>Your activities</b>
        </span>
        <i className="room-chevron" aria-hidden>
          ›
        </i>
      </button>
      <button type="button" className="room-row" onClick={onOpenTools}>
        <span className="room-row-text">
          <b>Tools</b>
        </span>
        <i className="room-chevron" aria-hidden>
          ›
        </i>
      </button>
      <button type="button" className="room-row" onClick={onOpenNutrition}>
        <span className="room-row-text">
          <b>Nutrition</b>
        </span>
        <i className="room-chevron" aria-hidden>
          ›
        </i>
      </button>
      <SettingsConstraintsRow constraints={constraints} />
    </section>
  );
}
