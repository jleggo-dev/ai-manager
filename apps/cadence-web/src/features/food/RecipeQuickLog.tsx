/**
 * MP24 — the confirm a one-tap "planned" or "usual" recipe row opens.
 *
 * A quick-add row hands over only a `recipe_id`; `RecipeLogConfirm` needs the whole `Recipe` (for
 * its servings math and the dietary-safety check). This fetches it and then renders that same
 * confirm — nothing new is built, this only bridges an id
 * to it. `CookSheet` already holds a full `Recipe` by the time it logs, so it renders
 * `RecipeLogConfirm` directly and has no need for this wrapper.
 */
import { useEffect, useState } from 'react';
import type { Recipe } from '@cadence/shared';
import { getRecipeById, type Meal, type MealKind } from '../../lib/api.ts';
import { RecipeLogConfirm } from './RecipeLogConfirm.tsx';

export function RecipeQuickLog({
  recipeId,
  initialMeal,
  initialServings,
  onCancel,
  onLogged,
}: {
  recipeId: string;
  initialMeal?: MealKind;
  initialServings?: number;
  onCancel: () => void;
  onLogged: (meal: Meal) => void;
}) {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    setErr('');
    setRecipe(null);
    getRecipeById(recipeId).then((r) => {
      if (!alive) return;
      if (r.status === 'ok' && r.recipe) setRecipe(r.recipe);
      else setErr("Couldn't open that recipe — try again in a moment.");
    });
    return () => {
      alive = false;
    };
  }, [recipeId]);

  if (err) {
    return (
      <div className="food-confirm" role="region" aria-label="Confirm recipe log">
        <div className="food-empty">{err}</div>
        <button type="button" className="lockbtn ghost" onClick={onCancel}>
          Back
        </button>
      </div>
    );
  }

  if (!recipe) {
    return (
      <div className="food-confirm" role="region" aria-label="Confirm recipe log">
        <div className="chat-loading">
          <span className="typing">
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    );
  }

  return (
    <RecipeLogConfirm
      recipe={recipe}
      initialMeal={initialMeal}
      initialServings={initialServings}
      onCancel={onCancel}
      onLogged={onLogged}
    />
  );
}
