/**
 * Thin coach confirm sheet over existing Food/Recipe confirms (Req 5 coach surface).
 * API prepares the draft; nothing commits until the user confirms here.
 */
import { useEffect, useState } from 'react';
import type { DietaryProfile, Recipe } from '@cadence/shared';
import {
  estimateFood,
  getDietaryProfile,
  getFoodById,
  getRecipeById,
  portionHintFromResolve,
  type MealKind,
  type ResolveCandidate,
} from '../../lib/api.ts';
import type { CoachFoodAction } from '../../lib/api/coach-food.ts';
import { FoodPortionConfirm } from '../food/FoodPortionConfirm.tsx';
import { RecipeLogConfirm } from '../food/RecipeLogConfirm.tsx';
import { RecipeSaveConfirm } from '../food/RecipeSaveConfirm.tsx';
import type { FoodDraft } from '../food/foodDraft.ts';
import { CoachDietaryConfirm } from './CoachDietaryConfirm.tsx';

type View =
  | { mode: 'loading' }
  | { mode: 'pick'; candidates: ResolveCandidate[]; mealHint?: MealKind }
  | { mode: 'food'; draft: FoodDraft; mealHint?: MealKind }
  | { mode: 'recipe_log'; recipe: Recipe; mealHint?: MealKind; servings?: number }
  | { mode: 'recipe_save' }
  | { mode: 'dietary' }
  | { mode: 'error'; message: string };

function pickBest(action: Extract<CoachFoodAction, { kind: 'log_food' }>): ResolveCandidate | null {
  if (action.resolve.preselected && action.resolve.preselected.kind !== 'new') return action.resolve.preselected;
  return (
    action.resolve.candidates.find((c) => c.kind === 'food' && c.food_id) ??
    action.resolve.candidates.find((c) => c.kind === 'recipe' && c.recipe_id) ??
    null
  );
}

export function CoachFoodActionSheet({
  action,
  onClose,
  onDone,
}: {
  action: CoachFoodAction;
  onClose: () => void;
  onDone: () => void;
}) {
  const [dietary, setDietary] = useState<DietaryProfile | null>(null);
  const [view, setView] = useState<View>({ mode: 'loading' });

  useEffect(() => {
    getDietaryProfile().then((r) => {
      if (r.status === 'ok') setDietary(r.profile);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function openLog(a: Extract<CoachFoodAction, { kind: 'log_food' }>) {
      const best = pickBest(a);
      const mealHint = a.mealHint ?? a.usualMeal;

      if (!best) {
        // No saved match — draft a new food from the words (confirm before save/log).
        const est = await estimateFood(a.query);
        if (cancelled) return;
        if (est.status !== 'ok' || !est.candidate) {
          setView({
            mode: 'error',
            message: "I couldn't match that yet — try the Food tab, or say it another way.",
          });
          return;
        }
        setView({ mode: 'food', draft: { kind: 'candidate', candidate: est.candidate }, mealHint });
        return;
      }

      if (best.kind === 'recipe' && best.recipe_id) {
        const detail = await getRecipeById(best.recipe_id);
        if (cancelled) return;
        if (detail.status !== 'ok' || !detail.recipe) {
          setView({ mode: 'error', message: "Couldn't open that recipe just now." });
          return;
        }
        const qty =
          typeof best.inferred_quantity === 'number' && best.inferred_quantity > 0 ? best.inferred_quantity : 1;
        setView({ mode: 'recipe_log', recipe: detail.recipe, mealHint, servings: qty });
        return;
      }

      if (best.kind === 'food' && best.food_id) {
        // Ambiguous: several close foods and no clear preselect → let them pick.
        const foods = a.resolve.candidates.filter((c) => c.kind === 'food' && c.food_id);
        if (!a.resolve.preselected && foods.length > 1) {
          setView({ mode: 'pick', candidates: foods, mealHint });
          return;
        }
        const detail = await getFoodById(best.food_id);
        if (cancelled) return;
        if (detail.status !== 'ok' || !detail.food) {
          setView({ mode: 'error', message: "Couldn't open that food just now." });
          return;
        }
        const portion = portionHintFromResolve(best);
        setView({
          mode: 'food',
          draft: {
            kind: 'saved',
            food: detail.food,
            ...(portion.servingIndex != null ? { servingIndex: portion.servingIndex } : {}),
            ...(portion.quantity != null ? { quantity: portion.quantity } : {}),
          },
          mealHint,
        });
        return;
      }

      setView({ mode: 'error', message: 'Say it again, or open the Food tab to log it.' });
    }

    if (action.kind === 'log_food') void openLog(action);
    else if (action.kind === 'save_recipe') setView({ mode: 'recipe_save' });
    else if (action.kind === 'dietary_update') setView({ mode: 'dietary' });

    return () => {
      cancelled = true;
    };
  }, [action]);

  async function pickCandidate(c: ResolveCandidate, mealHint?: MealKind) {
    if (c.kind === 'food' && c.food_id) {
      const detail = await getFoodById(c.food_id);
      if (detail.status !== 'ok' || !detail.food) {
        setView({ mode: 'error', message: "Couldn't open that food just now." });
        return;
      }
      const portion = portionHintFromResolve(c);
      setView({
        mode: 'food',
        draft: {
          kind: 'saved',
          food: detail.food,
          ...(portion.servingIndex != null ? { servingIndex: portion.servingIndex } : {}),
          ...(portion.quantity != null ? { quantity: portion.quantity } : {}),
        },
        mealHint,
      });
      return;
    }
    if (c.kind === 'recipe' && c.recipe_id) {
      const detail = await getRecipeById(c.recipe_id);
      if (detail.status !== 'ok' || !detail.recipe) {
        setView({ mode: 'error', message: "Couldn't open that recipe just now." });
        return;
      }
      setView({ mode: 'recipe_log', recipe: detail.recipe, mealHint });
    }
  }

  return (
    <div className="sheet-scrim" role="presentation" onClick={onClose}>
      <div
        className="sheet coach-food-sheet"
        role="dialog"
        aria-label="Confirm food action"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grab" />
        <div className="sheet-head">
          <div className="sheet-title">
            <b>Quick confirm</b>
            <span>Nothing counts until you say so</span>
          </div>
          <button type="button" className="sheet-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="sheet-body">
          {view.mode === 'loading' && (
            <div className="sheet-loading">
              <span className="typing">
                <i />
                <i />
                <i />
              </span>
              <div className="sheet-loading-t">Matching what you said…</div>
            </div>
          )}
          {view.mode === 'error' && (
            <div className="sheet-msg">
              {view.message}
              <div className="food-confirm-actions">
                <button type="button" className="lockbtn ghost" onClick={onClose}>
                  Close
                </button>
              </div>
            </div>
          )}
          {view.mode === 'pick' && (
            <div className="food-panel">
              <div className="food-panel-t">A few close matches</div>
              <p className="food-panel-p">Pick one — you&apos;ll confirm the portion next.</p>
              <ul className="coach-food-pick">
                {view.candidates.map((c) => (
                  <li key={`${c.kind}-${c.food_id ?? c.recipe_id ?? c.label}`}>
                    <button
                      type="button"
                      className="coach-food-pick-btn"
                      onClick={() => void pickCandidate(c, view.mealHint)}
                    >
                      {c.label}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="food-confirm-actions">
                <button type="button" className="lockbtn ghost" onClick={onClose}>
                  Not now
                </button>
              </div>
            </div>
          )}
          {view.mode === 'food' && (
            <FoodPortionConfirm
              draft={view.draft}
              dietary={dietary}
              initialMeal={view.mealHint}
              onCancel={onClose}
              onLogged={onDone}
            />
          )}
          {view.mode === 'recipe_log' && (
            <RecipeLogConfirm
              recipe={view.recipe}
              dietary={dietary}
              initialMeal={view.mealHint}
              initialServings={view.servings}
              onCancel={onClose}
              onLogged={onDone}
            />
          )}
          {view.mode === 'recipe_save' && action.kind === 'save_recipe' && (
            <RecipeSaveConfirm draft={action.draft} dietary={dietary} onCancel={onClose} onSaved={() => onDone()} />
          )}
          {view.mode === 'dietary' && action.kind === 'dietary_update' && (
            <CoachDietaryConfirm proposed={action.proposed} onCancel={onClose} onSaved={onDone} />
          )}
        </div>
      </div>
    </div>
  );
}
