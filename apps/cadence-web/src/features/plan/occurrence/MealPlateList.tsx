import { macrosForLog } from '@cadence/shared';
import { round2 } from './mealPlate.ts';
import type { PlateEntry } from './useMealCapture.ts';

/** The plate's item rows (design 2D) — each a thumb-less line with name, a ±0.25 stepper, and macros. */
export function MealPlateList({
  plate,
  busy,
  onQty,
  onRemove,
}: {
  plate: PlateEntry[];
  busy: boolean;
  onQty: (i: number, q: number) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="mc-platelist">
      {plate.map((e, i) => {
        const m = macrosForLog(e.food, { servingIndex: e.servingIndex, quantity: e.quantity });
        const sub = [
          e.food.servings[e.servingIndex]?.label,
          m.kcal ? `${Math.round(m.kcal)} kcal` : '',
          m.protein_g ? `P${Math.round(m.protein_g)}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <div className="mc-item" key={`${e.food.food_id}-${i}`}>
            <div className="mc-item-t">
              <b>{e.food.name}</b>
              <span>{sub}</span>
            </div>
            <div className="mc-item-q">
              <button
                type="button"
                className="mc-istep"
                aria-label="Less"
                disabled={busy || e.quantity <= 0.25}
                onClick={() => onQty(i, Math.max(0.25, round2(e.quantity - 0.25)))}
              >
                −
              </button>
              <b>{e.quantity}</b>
              <button
                type="button"
                className="mc-istep"
                aria-label="More"
                disabled={busy}
                onClick={() => onQty(i, round2(e.quantity + 0.25))}
              >
                +
              </button>
            </div>
            <button
              type="button"
              className="mc-item-x"
              aria-label={`Remove ${e.food.name}`}
              disabled={busy}
              onClick={() => onRemove(i)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
