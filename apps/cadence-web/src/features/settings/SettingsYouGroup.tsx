import type { ReviewData, UserConstraint } from '../../lib/api.ts';
import { SettingsConstraintsRow } from './SettingsConstraintsRow.tsx';

/** "N things · kettlebell, bands, a bike…" — a short preview, not the whole inventory. */
function toolsSummary(equipment: ReviewData['equipment']): string {
  if (equipment.length === 0) return "Nothing on file yet — tell your coach what you've got";
  const names = equipment.map((e) => e.name);
  const preview = names.slice(0, 3).join(', ');
  const noun = equipment.length === 1 ? 'thing' : 'things';
  return `${equipment.length} ${noun} · ${preview}${names.length > 3 ? '…' : ''}`;
}

/**
 * "YOU & YOUR COACH" (design owner-approved 2026-08-31). `review` is fetched once by
 * `SettingsRoom` (the same `getReview()` call `WeighInSettings` already uses) and
 * handed down here so goal/equipment counts and the sub-screens' underlying data can never
 * disagree about what is "on the plan" right now.
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
          <span>Rename or retire a goal{onPlan != null ? ` · ${onPlan} on the plan` : ''}</span>
        </span>
        <i className="room-chevron" aria-hidden>
          ›
        </i>
      </button>
      <button type="button" className="room-row" onClick={onOpenActivities}>
        <span className="room-row-text">
          <b>Your activities</b>
          <span>{"Run, rename, duplicate, or delete what you've built"}</span>
        </span>
        <i className="room-chevron" aria-hidden>
          ›
        </i>
      </button>
      <button type="button" className="room-row" onClick={onOpenTools}>
        <span className="room-row-text">
          <b>{"What you're working with"}</b>
          <span>{review ? toolsSummary(review.equipment) : 'Loading…'}</span>
        </span>
        <i className="room-chevron" aria-hidden>
          ›
        </i>
      </button>
      <button type="button" className="room-row" onClick={onOpenNutrition}>
        <span className="room-row-text">
          <b>Nutrition</b>
          <span>Targets, allergies, things to skip</span>
        </span>
        <i className="room-chevron" aria-hidden>
          ›
        </i>
      </button>
      <SettingsConstraintsRow constraints={constraints} />
    </section>
  );
}
