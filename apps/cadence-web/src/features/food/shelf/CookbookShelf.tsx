import { useMemo, useState } from 'react';
import type { Recipe } from '@cadence/shared';
import { useRecipes } from '../../../lib/query/index.ts';

/**
 * The cookbook shelf (canvas S2, meal-logging rework P6) — the LOGGING-side picker behind the
 * meal screen's "start from one of yours" door. One shelf, no Recipes/Meals/Foods tab triple:
 * bracketed rows drawn with the same `.mb-*` mark as everywhere else, and the only on-screen
 * distinction is yield. Green bracket (yield 1) — tap the row and it's logged. Butter bracket
 * (makes several) — pick how many portions first.
 *
 * The word "recipe" is allowed here — the shelf and the coach are the only two places it is.
 * The Kitchen tab keeps its prep framing and its own no-logging ruling; both read the same data.
 *
 * This component only PICKS: `onPick(recipe, servings)` hands the choice to the caller (P4's
 * meal screen), which owns the append and the snapshot semantics.
 */
export function CookbookShelf({
  onPick,
  onClose,
}: {
  onPick: (recipe: Recipe, servings: number) => void;
  onClose: () => void;
}) {
  // The shelf the meal screen's empty state and the kitchen read too (lib/query/useFoodData.ts):
  // opening the door twice costs one read, and the second time it opens on the shelf already.
  const { data, isPending, isError } = useRecipes(true);
  const recipes = useMemo(() => data?.recipes ?? [], [data]);
  // 'unavailable' is an older server, not a failure — it reads as an honest empty shelf.
  const status: 'loading' | 'ok' | 'error' = data ? 'ok' : isError ? 'error' : isPending ? 'loading' : 'ok';
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState<Recipe | null>(null);
  const [n, setN] = useState(1);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return recipes;
    return recipes.filter(
      (r) => r.name.toLowerCase().includes(needle) || r.ingredients.some((i) => i.name.toLowerCase().includes(needle)),
    );
  }, [recipes, q]);

  const ones = shown.filter((r) => !(r.servings > 1));
  const several = shown.filter((r) => r.servings > 1);
  const pickKcal = picking?.macros_per_serving?.kcal;

  const startPick = (recipe: Recipe) => {
    if (recipe.servings > 1) {
      setN(1);
      setPicking(recipe);
    } else {
      onPick(recipe, 1);
    }
  };

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet cs-shelf" role="dialog" aria-label="My cookbook">
        <div className="sheet-grab" aria-hidden />
        <header className="cs-shelf-head">
          <button type="button" className="cs-back" aria-label="Close the cookbook" onClick={onClose}>
            ‹
          </button>
          <h3>My cookbook</h3>
        </header>

        <input
          className="cs-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your meals and recipes…"
          aria-label="Search your meals and recipes"
        />

        <div className="cs-shelf-scroll">
          {status === 'error' && (
            <p className="cs-note">Couldn’t reach your cookbook just now — have another look in a moment.</p>
          )}
          {status === 'ok' && recipes.length === 0 && (
            <p className="cs-note">Nothing here yet. Name a bracket in any meal and it lands on this shelf.</p>
          )}
          {status === 'ok' && recipes.length > 0 && shown.length === 0 && <p className="cs-note">Nothing matches.</p>}

          {ones.length > 0 && (
            <>
              <div className="cs-shelf-sec">{"ONE PORTION · TAP AND IT'S LOGGED"}</div>
              {ones.map((r) => (
                <ShelfRow key={r.recipe_id} recipe={r} several={false} onTap={() => startPick(r)} />
              ))}
            </>
          )}

          {several.length > 0 && (
            <>
              <div className="cs-shelf-sec">MAKES SEVERAL · PICK A PORTION</div>
              {several.map((r) => (
                <ShelfRow key={r.recipe_id} recipe={r} several onTap={() => startPick(r)} />
              ))}
            </>
          )}
        </div>

        {!picking && (
          <p className="cs-foot">
            {'A green bracket is one portion. A butter bracket makes several. '}
            {"That's the whole taxonomy — no tabs."}
          </p>
        )}

        {picking && (
          <div className="cs-pick" role="dialog" aria-label={picking.name}>
            <div className="cs-pick-head">
              <div className="mb-rail mb-rail--butter mb-rail--head" />
              <div className="cs-pick-words">
                <b>{picking.name}</b>
                <span>{`makes ${picking.servings}`}</span>
              </div>
            </div>
            <div className="cs-stepper cs-stepper--pick">
              <button type="button" aria-label="Fewer servings" disabled={n <= 1} onClick={() => setN(n - 1)}>
                −
              </button>
              <b>{`${n} of ${picking.servings} servings`}</b>
              <button
                type="button"
                aria-label="More servings"
                disabled={n >= picking.servings}
                onClick={() => setN(n + 1)}
              >
                ＋
              </button>
            </div>
            {typeof pickKcal === 'number' && (
              <div className="cs-pick-kcal">{`${Math.round(pickKcal * n).toLocaleString('en-US')} kcal`}</div>
            )}
            <button type="button" className="mb-amber-btn" onClick={() => onPick(picking, n)}>
              {n === 1 ? 'Log 1 serving' : `Log ${n} servings`}
            </button>
            <button type="button" className="mb-quiet-btn" onClick={() => setPicking(null)}>
              Back
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/** One bracketed row (S2): the mark, the name, the members underneath, kcal on the right. */
function ShelfRow({ recipe, several, onTap }: { recipe: Recipe; several: boolean; onTap: () => void }) {
  const kcal = recipe.macros_per_serving?.kcal;
  const members = recipe.ingredients
    .map((i) => i.name)
    .filter(Boolean)
    .join(' · ');
  const sub = several ? `makes ${recipe.servings}` : members;
  return (
    <div className={`mb-block cs-shelf-block${several ? ' mb-part--yield' : ''}`}>
      <div className="mb-rail" />
      <button
        type="button"
        className="cs-shelf-row"
        onClick={onTap}
        aria-label={
          several ? `${recipe.name} — makes ${recipe.servings}, pick a portion` : `${recipe.name} — log one portion`
        }
      >
        <span className="cs-shelf-words">
          <span className="cs-shelf-name">{recipe.name}</span>
          {sub && <span className="cs-shelf-sub">{sub}</span>}
        </span>
        <span className="cs-shelf-kcal">
          <b>{typeof kcal === 'number' ? Math.round(kcal).toLocaleString('en-US') : '—'}</b>
          <i>{several ? 'PER SERVING' : 'KCAL'}</i>
        </span>
      </button>
    </div>
  );
}
