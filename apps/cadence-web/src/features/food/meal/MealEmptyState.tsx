/**
 * An empty breakfast (canvas 1b B1) — "the empty state is the whole argument": a titled meal
 * with a place for things to go, your usual bowl as one tap, and the doors as a row of small
 * buttons rather than the main event. The one-food express lane and the way back out to the
 * greater Food screen (owner constraint) both live here.
 */
import type { MealKind } from '@cadence/shared';
import { useRecipes } from '../../../lib/query/index.ts';
import { FoodPickHead, FoodPickRow } from '../FoodPickRow.tsx';
import { useUsualAtSlot } from '../useUsualAtSlot.ts';
import { fmtKcal } from '../bracket/copy.ts';

export interface YoursRow {
  recipe_id: string;
  name: string;
  sub?: string;
  kcal?: number;
}

/** Saved one-portion recipes ("what a person would call a saved meal") + the slot's habits. */
function useStartFromYours(kind: MealKind): YoursRow[] {
  const usual = useUsualAtSlot(kind);
  // Shared with the cookbook shelf and the kitchen (lib/query/useFoodData.ts) — one read, and the
  // rows are here as the empty state draws rather than a round trip into it.
  const { data } = useRecipes(true);
  const saved = (data?.recipes ?? []).filter((rec) => rec.servings === 1);
  const rows: YoursRow[] = usual
    .filter((u) => u.kind === 'recipe')
    .map((u) => ({ recipe_id: u.id, name: u.name, sub: u.serving_label ?? undefined, kcal: u.kcal ?? undefined }));
  for (const rec of saved) {
    if (rows.some((r) => r.recipe_id === rec.recipe_id)) continue;
    rows.push({
      recipe_id: rec.recipe_id,
      name: rec.name,
      sub:
        rec.ingredients
          .map((i) => i.name.split(',')[0])
          .slice(0, 4)
          .join(' · ') || undefined,
      kcal: typeof rec.macros_per_serving.kcal === 'number' ? rec.macros_per_serving.kcal : undefined,
    });
  }
  return rows.slice(0, 4);
}

export function MealEmptyState({
  kind,
  busy,
  onSearch,
  onPhoto,
  onBarcode,
  onRecents,
  onMyMeals,
  onAddRecipe,
  onExpressSingle,
  onOpenDay,
}: {
  kind: MealKind;
  busy?: boolean;
  onSearch: () => void;
  onPhoto: (file: File | undefined) => void;
  onBarcode: () => void;
  onRecents: () => void;
  onMyMeals: () => void;
  onAddRecipe: (recipeId: string) => void;
  onExpressSingle: () => void;
  onOpenDay?: () => void;
}) {
  const yours = useStartFromYours(kind);
  return (
    <div className="ms-empty">
      <div className="ms-empty-mark" aria-hidden="true">
        ◌
      </div>
      <h3>Add everything you had</h3>
      <p className="ms-empty-sub">
        {"One at a time or all in one sentence — it's the same meal either way. Nothing counts until you close it."}
      </p>
      <button type="button" className="ms-field" onClick={onSearch}>
        Search, or just describe it…
      </button>
      <div className="ms-doors">
        <label className="ms-door">
          <i aria-hidden="true">◲</i>
          Picture
          <input
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            disabled={busy}
            onChange={(e) => {
              onPhoto(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <button type="button" className="ms-door" disabled={busy} onClick={onBarcode}>
          <i aria-hidden="true">▥</i>
          Barcode
        </button>
        <button type="button" className="ms-door" disabled={busy} onClick={onRecents}>
          <i aria-hidden="true">◷</i>
          Recents
        </button>
        <button type="button" className="ms-door" disabled={busy} onClick={onMyMeals}>
          <i aria-hidden="true">◍</i>
          My meals
        </button>
      </div>
      {yours.length > 0 && (
        <div>
          <FoodPickHead label="START FROM ONE OF YOURS" />
          {yours.map((r) => (
            <FoodPickRow
              key={r.recipe_id}
              name={r.name}
              sub={r.sub}
              kcal={r.kcal != null ? `${fmtKcal(r.kcal)} kcal` : undefined}
              busy={busy}
              onAdd={() => onAddRecipe(r.recipe_id)}
            />
          ))}
        </div>
      )}
      <button type="button" className="ms-express" onClick={onExpressSingle}>
        {"Just one thing and you're done? "}
        <b>Log a single food instead ›</b>
      </button>
      {onOpenDay && (
        <button type="button" className="ms-day-link" onClick={onOpenDay}>
          Your whole day ›
        </button>
      )}
    </div>
  );
}
