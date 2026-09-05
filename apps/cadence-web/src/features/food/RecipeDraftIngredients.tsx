/**
 * The ingredient list on a recipe draft, with the amounts nobody stated left open to fill in.
 *
 * `structure-recipe` used to pick "one reasonable qty" whenever the person was vague ("some
 * onion"). It now says it does not know, and this is where that shows: a row with no amount gets
 * an empty, highlighted box instead of a number, and the recipe cannot be saved until the box has
 * one. Every other row reads exactly as it did.
 */
import { useState } from 'react';
import { isAmountUnstated } from '@cadence/shared';
import type { RecipeIngredientRow } from '../../lib/api.ts';
import { withAmount } from './recipeAmount.ts';

export function RecipeDraftIngredients({
  ingredients,
  disabled,
  onChange,
}: {
  ingredients: RecipeIngredientRow[];
  disabled?: boolean;
  onChange: (next: RecipeIngredientRow[]) => void;
}) {
  // What is in each box, character by character — so half-typed amounts ("1.", "0.") survive the
  // round trip through the parsed row instead of being rewritten under the cursor.
  const [typed, setTyped] = useState<Record<number, string>>({});
  // Which rows arrived without an amount. Fixed at first render on purpose: a box must not vanish
  // the moment it reads as a number, mid-keystroke, with the cursor still in it.
  const [asking] = useState(() => new Set(ingredients.flatMap((ing, i) => (isAmountUnstated(ing) ? [i] : []))));

  if (ingredients.length === 0) return null;

  function setAt(index: number, raw: string) {
    setTyped((prev) => ({ ...prev, [index]: raw }));
    onChange(ingredients.map((ing, i) => (i === index ? withAmount(ing, raw) : ing)));
  }

  return (
    <div className="food-recipe-ings" aria-label="Ingredients">
      <div className="food-panel-t" style={{ fontSize: 13.5 }}>
        Ingredients
      </div>
      <ul className="food-recipe-ing-list">
        {ingredients.map((ing, i) =>
          asking.has(i) ? (
            <li key={`${ing.name}-${i}`} className="food-recipe-ing-ask">
              <input
                className="wiz-in food-recipe-amount"
                type="text"
                inputMode="decimal"
                aria-label={`Amount of ${ing.name}`}
                placeholder="amount?"
                disabled={disabled}
                value={typed[i] ?? ''}
                onChange={(e) => setAt(i, e.target.value)}
              />
              <span>
                {ing.unit ? `${ing.unit} ` : ''}
                {ing.name}
              </span>
            </li>
          ) : (
            <li key={`${ing.name}-${i}`}>
              {ing.qty}
              {ing.unit ? ` ${ing.unit}` : ''} {ing.name}
              {!ing.food_id ? ' · estimated' : ''}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
