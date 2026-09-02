/**
 * Confirm-first "log again" — N servings of a saved recipe. Nothing logs until Confirm.
 */
import { useState } from 'react';
import type { DietaryProfile, Recipe } from '@cadence/shared';
import { assessDietarySafety, MEAL_KINDS } from '@cadence/shared';
import { logMealFromRecipe, recipeMacroHint, type Meal, type MealKind } from '../../lib/api.ts';
import { useInvalidateNutritionDay } from '../../lib/query/index.ts';
import { mealForNow } from '../plan/occurrence/format.ts';

function scaleMacros(recipe: Recipe, servings: number) {
  const m = recipe.macros_per_serving;
  const scale = (n: number | undefined) => (typeof n === 'number' ? n * servings : undefined);
  return {
    kcal: scale(m.kcal),
    protein_g: scale(m.protein_g),
    carbs_g: scale(m.carbs_g),
    fat_g: scale(m.fat_g),
  };
}

export function RecipeLogConfirm({
  recipe,
  dietary,
  initialMeal,
  initialServings,
  onCancel,
  onLogged,
}: {
  recipe: Recipe;
  dietary?: DietaryProfile | null;
  /** Prefill meal kind (e.g. coach "usual breakfast"). */
  initialMeal?: MealKind;
  initialServings?: number;
  onCancel: () => void;
  /** The written row, so a caller that reads the day back after the log
   *  can do the same here — a recipe log used to skip that step entirely. */
  onLogged: (meal: Meal) => void;
}) {
  const [servings, setServings] = useState(() =>
    typeof initialServings === 'number' && Number.isFinite(initialServings) && initialServings > 0
      ? initialServings
      : 1,
  );
  const [meal, setMeal] = useState<MealKind>(() => initialMeal ?? mealForNow());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [allergyOverride, setAllergyOverride] = useState(false);
  const invalidateNutritionDay = useInvalidateNutritionDay();

  const preview = recipeMacroHint(scaleMacros(recipe, servings));
  const safetyTerms = [recipe.name, ...recipe.ingredients.map((i) => i.name), ...recipe.tags];
  const safety = dietary ? assessDietarySafety(dietary, safetyTerms) : { safe: true, flags: [] };
  const allergyFlags = safety.flags.filter((f) => f.severity === 'allergy');

  async function confirm(opts?: { ignoreAllergy?: boolean }) {
    if (busy) return;
    if (allergyFlags.length && !opts?.ignoreAllergy && !allergyOverride) {
      setErr(
        `Heads up — this may include ${allergyFlags.map((f) => f.term).join(', ')}. Edit, cancel, or confirm you still want it logged.`,
      );
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const logged = await logMealFromRecipe({
        recipe_id: recipe.recipe_id,
        servings,
        meal,
      });
      if (!logged) {
        setErr("Couldn't log that just now — try again in a moment.");
        return;
      }
      await invalidateNutritionDay();
      onLogged(logged);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="food-confirm" role="region" aria-label="Confirm recipe log">
      <div className="food-panel-t">Log {recipe.name}?</div>
      <p className="food-panel-p">
        Nothing counts until you confirm. Pick how many servings — I&apos;ll scale the per-serving numbers.
      </p>

      <label className="food-field">
        <span>Servings</span>
        <input
          className="wiz-in"
          type="number"
          min={0.25}
          step={0.25}
          value={servings}
          disabled={busy}
          onChange={(e) => {
            const n = Number(e.target.value);
            setServings(Number.isFinite(n) && n > 0 ? n : 1);
          }}
        />
      </label>

      <label className="food-field">
        <span>Meal</span>
        <select className="wiz-in" value={meal} disabled={busy} onChange={(e) => setMeal(e.target.value as MealKind)}>
          {MEAL_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>

      {preview && <div className="food-macro-preview">{preview}</div>}
      {allergyFlags.length > 0 && (
        <div className="food-allergy-warn" role="alert">
          This may conflict with your allergies ({allergyFlags.map((f) => f.term).join(', ')}). I won&apos;t log it
          unless you say so.
        </div>
      )}
      {err && <div className="food-empty">{err}</div>}

      <div className="food-confirm-actions">
        <button type="button" className="lockbtn" disabled={busy} onClick={() => void confirm()}>
          {busy ? 'Logging…' : 'Looks right — log it'}
        </button>
        {allergyFlags.length > 0 && (
          <button
            type="button"
            className="lockbtn ghost"
            disabled={busy}
            onClick={() => {
              setAllergyOverride(true);
              void confirm({ ignoreAllergy: true });
            }}
          >
            Log it anyway — I know
          </button>
        )}
        <button type="button" className="lockbtn ghost" disabled={busy} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}
