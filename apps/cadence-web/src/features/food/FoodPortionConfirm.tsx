/**
 * Confirm-first portion picker — serving unit + quantity, macros via shared math.
 * Nothing is saved/logged until the user taps Confirm.
 */
import { useState } from 'react';
import { assessDietarySafety, macrosForLog, type DietaryProfile, type Food } from '@cadence/shared';
import { createFood, logMealFromFood, type FoodCandidate, type MealKind } from '../../lib/api.ts';
import { useInvalidateNutritionDay } from '../../lib/query/index.ts';
import { mealForNow } from '../plan/occurrence/format.ts';
import { draftBrand, draftName, type FoodDraft } from './foodDraft.ts';

const MEAL_KINDS: MealKind[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other'];

function foodShape(draft: FoodDraft): Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'> {
  return draft.kind === 'candidate' ? draft.candidate : draft.food;
}

function macroHint(n: { kcal?: number; protein_g?: number; carbs_g?: number; fat_g?: number }): string {
  const bits: string[] = [];
  if (n.kcal != null) bits.push(`~${Math.round(n.kcal)} kcal`);
  const pcf = [
    n.protein_g != null ? `P${Math.round(n.protein_g)}` : '',
    n.carbs_g != null ? `C${Math.round(n.carbs_g)}` : '',
    n.fat_g != null ? `F${Math.round(n.fat_g)}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (pcf) bits.push(pcf);
  return bits.join(' · ');
}

export function FoodPortionConfirm({
  draft,
  dietary,
  initialMeal,
  onCancel,
  onLogged,
}: {
  draft: FoodDraft;
  dietary?: DietaryProfile | null;
  /** Prefill meal kind (e.g. coach "usual breakfast"). */
  initialMeal?: MealKind;
  onCancel: () => void;
  onLogged: () => void;
}) {
  const shape = foodShape(draft);
  const [servingIndex, setServingIndex] = useState(() => {
    const fromResolver =
      typeof draft.servingIndex === 'number' && Number.isInteger(draft.servingIndex) ? draft.servingIndex : null;
    const fallback = shape.default_serving ?? 0;
    const idx = fromResolver ?? fallback;
    return Math.max(0, Math.min(idx, shape.servings.length - 1));
  });
  const [quantity, setQuantity] = useState(() =>
    typeof draft.quantity === 'number' && Number.isFinite(draft.quantity) && draft.quantity > 0 ? draft.quantity : 1,
  );
  const [meal, setMeal] = useState<MealKind>(() => initialMeal ?? mealForNow());
  const [name, setName] = useState(() => draftName(draft));
  const [brand, setBrand] = useState(() => draftBrand(draft) ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [allergyOverride, setAllergyOverride] = useState(false);
  const invalidateNutritionDay = useInvalidateNutritionDay();

  const nutrients = macrosForLog(shape, { servingIndex, quantity });
  const preview = macroHint(nutrients);
  const safety = dietary ? assessDietarySafety(dietary, [name, brand].filter(Boolean)) : { safe: true, flags: [] };
  const allergyFlags = safety.flags.filter((f) => f.severity === 'allergy');

  async function confirm(opts?: { ignoreAllergy?: boolean }) {
    if (busy) return;
    if (!name.trim()) {
      setErr('Give it a name so I can save it for next time.');
      return;
    }
    if (allergyFlags.length && !opts?.ignoreAllergy && !allergyOverride) {
      setErr(
        `Heads up — this looks like it may include ${allergyFlags.map((f) => f.term).join(', ')}. Edit the name, cancel, or confirm you still want it logged.`,
      );
      return;
    }
    setBusy(true);
    setErr('');
    try {
      let foodId: string;
      if (draft.kind === 'saved') {
        foodId = draft.food.food_id;
      } else {
        const candidate: FoodCandidate = {
          ...draft.candidate,
          name: name.trim(),
          brand: brand.trim() || null,
          default_serving: servingIndex,
        };
        const saved = await createFood(candidate);
        if (!saved) {
          setErr("Couldn't save that food just now — try again in a moment.");
          return;
        }
        foodId = saved.food_id;
      }
      const logged = await logMealFromFood({
        food_id: foodId,
        meal,
        serving_index: servingIndex,
        quantity,
      });
      if (!logged) {
        setErr(
          draft.kind === 'candidate'
            ? 'Saved the food, but logging to today hiccuped — try picking it from Recents.'
            : "Couldn't log that just now — try again in a moment.",
        );
        return;
      }
      await invalidateNutritionDay();
      onLogged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="food-confirm" role="region" aria-label="Confirm food log">
      <div className="food-panel-t">Here&apos;s what I heard — confirm?</div>
      <p className="food-panel-p">Nothing counts until you confirm. Adjust the portion if I guessed wrong.</p>

      {draft.kind === 'candidate' && draft.labelReadable === false && (
        <div className="food-empty">
          That label was hard to read — check the name and macros vibe before you confirm, or snap again.
        </div>
      )}

      <label className="food-field">
        <span>Name</span>
        <input
          className="wiz-in"
          value={name}
          disabled={busy || draft.kind === 'saved'}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="food-field">
        <span>Brand (optional)</span>
        <input
          className="wiz-in"
          value={brand}
          disabled={busy || draft.kind === 'saved'}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="e.g. Fage"
        />
      </label>

      <label className="food-field">
        <span>Serving</span>
        <select
          className="wiz-in"
          value={servingIndex}
          disabled={busy}
          onChange={(e) => setServingIndex(Number(e.target.value))}
        >
          {shape.servings.map((s, i) => (
            <option key={`${s.label}-${i}`} value={i}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <label className="food-field">
        <span>How many</span>
        <input
          className="wiz-in"
          type="number"
          min={0.25}
          step={0.25}
          value={quantity}
          disabled={busy}
          onChange={(e) => {
            const n = Number(e.target.value);
            setQuantity(Number.isFinite(n) && n > 0 ? n : 1);
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
          {busy ? 'Saving…' : 'Looks right — log it'}
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
