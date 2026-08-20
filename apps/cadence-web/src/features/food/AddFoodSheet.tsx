import { useState } from 'react';
import { macrosForLog, type Food } from '@cadence/shared';
import { FoodMacroCard } from './FoodMacroCard.tsx';
import { UnitSheet } from './UnitSheet.tsx';
import type { MealKind } from '../../lib/api.ts';

const MEALS: MealKind[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other'];

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Add food (design 05d) — the food picked from a list, a barcode, or quick add. Amounts here are
 * deliberately the pattern everybody already knows: **serving size, then number of servings**,
 * with a unit sheet behind the serving. Nothing is guessed, because nothing needs to be: the food
 * carries its own servings, so the only question is which one and how many.
 *
 * Confirm-first like every capture surface: what the card shows is what the log stores.
 */
export function AddFoodSheet({
  food,
  meal,
  busy,
  err,
  onLog,
  onBack,
}: {
  food: Food;
  meal: MealKind;
  busy?: boolean;
  err?: string;
  onLog: (portion: { servingIndex: number; quantity: number; meal: MealKind }) => void;
  onBack: () => void;
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
        <button type="button" className="fd-do" disabled={busy} onClick={() => onLog({ servingIndex, quantity, meal: slot })}>
          {busy ? 'Logging…' : 'Log'}
        </button>
      </div>

      <div className="fd-card">
        <div className="fd-name">
          <b>{food.name}</b>
          <span>
            {[food.brand, food.source === 'usda' || food.source === 'off' ? 'from the food list' : 'your saved food']
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>

        <div className="fd-field">
          <span className="fd-field-l">Serving size</span>
          <button type="button" className="fd-pick is-on" disabled={busy || food.servings.length < 2} onClick={() => setUnitOpen(true)}>
            {serving?.label ?? '1 serving'} {food.servings.length > 1 && <i aria-hidden>⌄</i>}
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
            <button type="button" aria-label="More servings" disabled={busy} onClick={() => setQuantity((q) => round2(q + 0.25))}>
              +
            </button>
          </div>
        </div>

        <div className="fd-field">
          <span className="fd-field-l">Meal</span>
          <select
            className="fd-pick is-on"
            value={slot}
            disabled={busy}
            aria-label="Meal"
            onChange={(e) => setSlot(e.target.value as MealKind)}
          >
            {MEALS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      <FoodMacroCard macros={macros} />

      <p className="fd-note">
        Picked from a list, scanned, or quick-added: amounts work the way they do everywhere else — serving size, then
        how many.
      </p>

      {err && <div className="food-empty">{err}</div>}

      {unitOpen && (
        <UnitSheet
          servings={food.servings}
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
