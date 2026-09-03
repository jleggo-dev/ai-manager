/**
 * The butter card for a title that names more than one piece (P6 "the room") — rendered by
 * RepertoireGroup.tsx right under the row it is about, never as its own group or its own screen.
 * Reuses ItemScreen's `.ri-collision` butter styling as-is (same fact, same visual language,
 * `styles/repertoire-item.css`) rather than restating the card chrome here.
 *
 * The app never proposes the distinction, only names that one exists — the same restraint
 * ItemScreen's own collision notice holds to. Its verb always opens the item screen on THIS row,
 * so "naming them apart" is a rename or a composer/collection/catalogue field, never a choice this
 * card makes for the person.
 */

/** The one sentence of consequence, exported so a test can pin it verbatim — never rewritten. */
export const COLLISION_CONSEQUENCE = "When you tell me you practised it, I can't tell which.";

export interface CollisionCardProps {
  /** The label of the row this card sits under. */
  label: string;
  /** Every other piece that answers to the same title (or the same needle). At least one. */
  otherLabels: string[];
  onNameApart: () => void;
}

export function CollisionCard({ label, otherLabels, onNameApart }: CollisionCardProps) {
  return (
    <div className="ri-collision rl-collision">
      <p>
        <b>&ldquo;{label}&rdquo;</b> also matches{' '}
        {otherLabels.map((other, i) => (
          <span key={other}>
            {i > 0 ? ' and ' : ''}
            <b>&ldquo;{other}&rdquo;</b>
          </span>
        ))}
        .
      </p>
      <p>{COLLISION_CONSEQUENCE}</p>
      <button type="button" className="rl-collision-cta" onClick={onNameApart}>
        Name them apart ›
      </button>
    </div>
  );
}
