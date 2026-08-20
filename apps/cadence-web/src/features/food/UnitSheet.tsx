import type { FoodServing } from '@cadence/shared';

/** "Select unit" (design 05d) — the food's own servings, one tap, with the current one ticked. */
export function UnitSheet({
  servings,
  selected,
  onPick,
  onClose,
}: {
  servings: FoodServing[];
  selected: number;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
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
        {servings.map((s, i) => (
          <button
            type="button"
            key={`${s.label}-${i}`}
            className={`fu-row${i === selected ? ' is-on' : ''}`}
            onClick={() => onPick(i)}
          >
            <span>{s.label}</span>
            {i === selected && (
              <i className="fu-tick" aria-hidden>
                ✓
              </i>
            )}
          </button>
        ))}
      </div>
    </>
  );
}
