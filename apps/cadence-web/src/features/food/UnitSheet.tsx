import type { Food } from '@cadence/shared';
import { compoundLabel, orderServingIndices } from './servingPicker.ts';

/**
 * "Select unit" (design 05d) — the food's own servings, one tap, with the current one ticked.
 *
 * MP3: the list walks `orderServingIndices(food)` rather than `food.servings` in storage order, so
 * packaged food and meat lead with weight (the number is already printed) and produce/scratch-
 * cooked food leads with volume or count (owner: "nobody weighs three shallots") — never dropping
 * either. MP39: a package-style row is labelled against a volume sibling when one exists, so
 * "1 container" reads as "1 container (4 cups ea.)" next to "1 cup".
 */
export function UnitSheet({
  food,
  selected,
  onPick,
  onClose,
}: {
  food: Pick<Food, 'brand' | 'source' | 'name' | 'servings'>;
  selected: number;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  const order = orderServingIndices(food);
  return (
    <>
      <div className="fu-scrim" onClick={onClose} aria-hidden />
      <div className="fu" role="dialog" aria-label="Select unit">
        <div className="fu-head">
          <b>Select unit</b>
          <button type="button" className="fu-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {order.map((i) => {
          const s = food.servings[i]!;
          return (
            <button
              type="button"
              key={`${s.label}-${i}`}
              className={`fu-row${i === selected ? ' is-on' : ''}`}
              onClick={() => onPick(i)}
            >
              <span>{compoundLabel(s, food.servings)}</span>
              {i === selected && (
                <i className="fu-tick" aria-hidden>
                  ✓
                </i>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
