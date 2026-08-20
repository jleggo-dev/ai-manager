import { useState } from 'react';
import { patchMeal, type Meal } from '../../lib/api.ts';
import { useInvalidateNutritionDay } from '../../lib/query/index.ts';
import { foldCandidate, mealContentsLine } from './mealSlotting.ts';

const summarise = (meal: Meal): string => meal.items.map((i) => i.name).join(', ') || meal.raw_text || 'logged';

/**
 * Where should it sit? (design 06) — offered right after something lands, when the day already has
 * a meal it could belong to. The thing is **counted either way**; this only changes how the day
 * reads back, and it can be moved later, so both answers are safe and neither is a commitment.
 */
export function MealSlotChoice({
  logged,
  meals,
  onDone,
}: {
  logged: Meal;
  /** Today's meals, newest first, as `GET /nutrition/day` returns them. */
  meals: Meal[];
  onDone: () => void;
}) {
  const fold = foldCandidate(meals, logged.log_id);
  const [choice, setChoice] = useState<'fold' | 'alone'>(fold ? 'fold' : 'alone');
  const [busy, setBusy] = useState(false);
  const invalidateNutritionDay = useInvalidateNutritionDay();

  // Nothing to choose between — the caller shows this only when there is.
  if (!fold) return null;

  async function done() {
    if (busy) return;
    setBusy(true);
    try {
      const want = choice === 'fold' ? fold!.meal : 'snack';
      if (want !== logged.meal) {
        await patchMeal(logged.log_id, { meal: want });
        await invalidateNutritionDay();
      }
    } finally {
      setBusy(false);
      onDone();
    }
  }

  return (
    <div className="fs-slot" role="region" aria-label="Where should it sit">
      <div className="fs-slot-top">
        <div className="fs-slot-t">
          <b>{summarise(logged)}</b>
          <span>
            {[logged.macros?.kcal != null ? `${Math.round(logged.macros.kcal)} kcal` : '', 'from your words']
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <span className="fs-counted">COUNTED</span>
      </div>

      <div className="fs-slot-q">Where should it sit?</div>
      <div className="fs-slot-opts">
        <button
          type="button"
          className={`fs-opt${choice === 'fold' ? ' is-on' : ''}`}
          disabled={busy}
          onClick={() => setChoice('fold')}
        >
          <b>With {fold.meal}</b>
          <span>{mealContentsLine(fold)}</span>
        </button>
        <button
          type="button"
          className={`fs-opt${choice === 'alone' ? ' is-on' : ''}`}
          disabled={busy}
          onClick={() => setChoice('alone')}
        >
          <b>On its own</b>
          <span>a snack</span>
        </button>
      </div>

      <p className="fs-slot-note">
        It&apos;s already counted either way — this only changes how your day reads back. You can move it later.
      </p>
      <button type="button" className="fa-log" disabled={busy} onClick={() => void done()}>
        {busy ? 'Saving…' : 'Done'}
      </button>
    </div>
  );
}
