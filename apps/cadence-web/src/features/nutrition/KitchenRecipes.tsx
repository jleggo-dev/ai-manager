import { useState } from 'react';
import type { Recipe } from '@cadence/shared';
import { recipeMacroHint } from '../../lib/api.ts';
import type { KitchenStatus } from './useKitchen.ts';

/**
 * The cookbook, read the Kitchen's way (Food Journey 10a) — every recipe with its PER-SERVING
 * numbers, because that is the number you cook against.
 *
 * There is deliberately no "log this" here. The Kitchen is prep: it decides what gets cooked and
 * what gets bought. A meal counts when it is eaten and logged, not when it is planned — so the one
 * action on a recipe is to put it on a day.
 */
export function KitchenRecipes({
  recipes,
  status,
  onPlan,
  onPaste,
  onSnap,
  onDiscover,
}: {
  recipes: Recipe[];
  status: KitchenStatus;
  /** Hand this recipe to the day-and-slot picker. */
  onPlan: (recipe: Recipe) => void;
  onPaste: () => void;
  /** Open the snap-the-fridge intake — photo in, recipe ideas out. */
  onSnap: () => void;
  /** Open recipe discovery; null while the endpoint isn't live, and the door stays hidden. */
  onDiscover: (() => void) | null;
}) {
  const [open, setOpen] = useState<Recipe | null>(null);

  if (open) {
    return (
      <div className="kt-detail" role="region" aria-label={`Recipe — ${open.name}`}>
        <button className="kt-linkback" onClick={() => setOpen(null)}>
          ‹ All recipes
        </button>
        <b className="kt-detail-t">{open.name}</b>
        <span className="kt-detail-sub">
          Serves {open.servings} · {recipeMacroHint(open.macros_per_serving) || 'no numbers yet'} per serving
        </span>
        {open.ingredients.length > 0 && (
          <>
            <div className="kt-sec">WHAT&apos;S IN IT</div>
            <ul className="kt-ings">
              {open.ingredients.map((i, n) => (
                <li key={`${i.name}-${n}`}>
                  <span>{i.name}</span>
                  <i>
                    {i.qty}
                    {i.unit ? ` ${i.unit}` : ''}
                  </i>
                </li>
              ))}
            </ul>
          </>
        )}
        {open.steps.length > 0 && (
          <>
            <div className="kt-sec">HOW IT GOES</div>
            <ol className="kt-steps">
              {open.steps.map((s, n) => (
                <li key={n}>{s}</li>
              ))}
            </ol>
          </>
        )}
        <button className="kt-primary" onClick={() => onPlan(open)}>
          Put it on a day <i aria-hidden>›</i>
        </button>
      </div>
    );
  }

  return (
    <div className="kt-list" role="region" aria-label="Your recipes">
      {status === 'unavailable' || status === 'error' ? (
        <div className="kt-msg">{"I can't reach your recipes just now — they're safe, try again in a moment."}</div>
      ) : status === 'loading' && recipes.length === 0 ? (
        // Not "nothing saved yet": we do not know that yet. Saying it while the read is still out
        // tells the person the one thing that might not be true, and then takes it back — which is
        // what the shelf did on every cold open before it was cached.
        <div className="kt-msg">Reading your recipes…</div>
      ) : recipes.length === 0 ? (
        <div className="kt-msg">
          Nothing saved yet. Paste one in and I&apos;ll work out the per-serving numbers.
          <button className="kt-inline" onClick={onPaste}>
            Paste a recipe
          </button>
        </div>
      ) : (
        recipes.map((r) => (
          <button className="kt-row" key={r.recipe_id} onClick={() => setOpen(r)}>
            <span className="kt-row-t">
              <b>{r.name}</b>
              <span>
                Serves {r.servings} · {recipeMacroHint(r.macros_per_serving) || 'no numbers yet'} per serving
              </span>
            </span>
            <i aria-hidden>›</i>
          </button>
        ))
      )}

      {/* The other ways a recipe gets in — the paste door stands above the whole tab, these two
          live with the cookbook the way they did on the old panel. Discovery only shows when the
          endpoint answers the probe: an entry that always errors is worse than no entry. */}
      <div className="kt-sec">ADD A RECIPE</div>
      <button className="kt-row" onClick={onSnap}>
        <span className="kt-row-t">
          <b>Snap the fridge</b>
          <span>Photo what you have — I&apos;ll read it and suggest what to cook</span>
        </span>
        <i aria-hidden>›</i>
      </button>
      {onDiscover && (
        <button className="kt-row" onClick={onDiscover}>
          <span className="kt-row-t">
            <b>Find a real recipe</b>
            <span>A few ideas to review — nothing is saved until you keep one</span>
          </span>
          <i aria-hidden>›</i>
        </button>
      )}
    </div>
  );
}
