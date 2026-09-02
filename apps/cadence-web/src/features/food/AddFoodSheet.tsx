import { useState, type ReactNode } from 'react';
import { isStoreFoodSource, macrosForLog, MEAL_KINDS, type Food } from '@cadence/shared';
import { FoodMacroCard } from './FoodMacroCard.tsx';
import { compoundLabel } from './servingPicker.ts';
import { UnitSheet } from './UnitSheet.tsx';
import type { MealKind } from '../../lib/api.ts';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Add food (design 05d) — the food picked from a list, a barcode, or quick add. Amounts here are
 * deliberately the pattern everybody already knows: **serving size, then number of servings**,
 * with a unit sheet behind the serving. Nothing is guessed, because nothing needs to be: the food
 * carries its own servings, so the only question is which one and how many.
 *
 * Confirm-first like every capture surface: what the card shows is what the log stores.
 *
 * Two modes since the meal-logging rework (canvas turn-3 B1 — "the sheet · add and stay"):
 * the default `log` mode writes a meal on its own, exactly as it always has; `draft` mode
 * repices the same sheet for the open meal — the button says "Add to breakfast", the slot
 * question disappears (the draft owns it), the caller's strip rides underneath, and `onAdd`
 * hands the portion back so the sheet RETURNS to search instead of dismissing to nowhere.
 */
export function AddFoodSheet({
  food,
  meal,
  mode = 'log',
  mealLabel,
  busy,
  err,
  onLog,
  onAdd,
  onBack,
  strip,
}: {
  food: Food;
  meal: MealKind;
  /** 'log' = the legacy write-a-meal sheet; 'draft' = add into the open meal and return. */
  mode?: 'log' | 'draft';
  /** Draft mode: the open meal's name for the button — "Add to breakfast". */
  mealLabel?: string;
  busy?: boolean;
  err?: string;
  onLog: (portion: { servingIndex: number; quantity: number; meal: MealKind }) => void;
  /** Draft mode's door back: the portion, without a slot — the draft already has one. */
  onAdd?: (portion: { servingIndex: number; quantity: number }) => void;
  onBack: () => void;
  /** Draft mode: the caller's strip ("N things · not counted yet"), drawn under the card. */
  strip?: ReactNode;
}) {
  const [servingIndex, setServingIndex] = useState(() =>
    Math.max(0, Math.min(food.default_serving ?? 0, food.servings.length - 1)),
  );
  const [quantity, setQuantity] = useState(1);
  const [slot, setSlot] = useState<MealKind>(meal);
  const [unitOpen, setUnitOpen] = useState(false);

  const serving = food.servings[servingIndex];
  const macros = macrosForLog(food, { servingIndex, quantity });

  return (
    <div className="fd">
      <div className="fd-head">
        <button type="button" className="fd-back" aria-label="Back" disabled={busy} onClick={onBack}>
          ‹
        </button>
        <h2>Add food</h2>
        <button
          type="button"
          className="fd-do"
          disabled={busy}
          onClick={() =>
            mode === 'draft' && onAdd
              ? onAdd({ servingIndex, quantity })
              : onLog({ servingIndex, quantity, meal: slot })
          }
        >
          {mode === 'draft' ? `Add to ${mealLabel ?? meal}` : busy ? 'Logging…' : 'Log'}
        </button>
      </div>

      <div className="fd-card">
        <div className="fd-name">
          <b>{food.name}</b>
          <span>
            {[food.brand, isStoreFoodSource(food.source) ? 'from the food list' : 'your saved food']
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>

        <div className="fd-field">
          <span className="fd-field-l">Serving size</span>
          <button
            type="button"
            className="fd-pick is-on"
            disabled={busy || food.servings.length < 2}
            onClick={() => setUnitOpen(true)}
          >
            {serving ? compoundLabel(serving, food.servings) : '1 serving'}{' '}
            {food.servings.length > 1 && <i aria-hidden>⌄</i>}
          </button>
        </div>

        <div className="fd-field">
          <span className="fd-field-l">Number of servings</span>
          <div className="fd-qty">
            <button
              type="button"
              aria-label="Fewer servings"
              disabled={busy || quantity <= 0.25}
              onClick={() => setQuantity((q) => Math.max(0.25, round2(q - 0.25)))}
            >
              −
            </button>
            <b>{quantity}</b>
            <button
              type="button"
              aria-label="More servings"
              disabled={busy}
              onClick={() => setQuantity((q) => round2(q + 0.25))}
            >
              +
            </button>
          </div>
        </div>

        {mode === 'log' && (
          <div className="fd-field">
            <span className="fd-field-l">Meal</span>
            <select
              className="fd-pick is-on"
              value={slot}
              disabled={busy}
              aria-label="Meal"
              onChange={(e) => setSlot(e.target.value as MealKind)}
            >
              {MEAL_KINDS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <FoodMacroCard macros={macros} />

      {mode === 'draft' ? (
        <>
          <p className="ms-sheet-return">{"You'll come straight back here for the next one."}</p>
          {strip}
        </>
      ) : (
        <p className="fd-note">
          Picked from a list, scanned, or quick-added: amounts work the way they do everywhere else — serving size, then
          how many.
        </p>
      )}

      {err && <div className="food-empty">{err}</div>}

      {unitOpen && (
        <UnitSheet
          food={food}
          selected={servingIndex}
          onPick={(i) => {
            setServingIndex(i);
            setUnitOpen(false);
          }}
          onClose={() => setUnitOpen(false)}
        />
      )}
    </div>
  );
}
