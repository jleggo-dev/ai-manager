/**
 * The shelf under the doors — what they usually have at this slot, one tap each, plus their
 * saved one-portion meals. No heading: the owner asked for the list, not a label over it
 * ("just show the most common breakfast foods", 2026-09-07), and for enough of it to scroll a
 * few pages — the six-row cap and the "logged N times" sub-line both went with it.
 *
 * The planned dish for the slot, when the week's menu names one, leads the list in its own tone.
 */
import type { MealKind } from '@cadence/shared';
import { useRecipes } from '../../../lib/query/index.ts';
import { fmtKcal } from '../bracket/copy.ts';
import { FoodPickRow } from '../FoodPickRow.tsx';
import { useUsualAtSlot } from '../useUsualAtSlot.ts';

export interface UsualRow {
  kind: 'food' | 'recipe';
  id: string;
  name: string;
  sub?: string;
  kcal?: string;
}

/** The slot's habits, counted, then the saved single-portion recipes not already among them. */
function useUsualRows(kind: MealKind): UsualRow[] {
  const usual = useUsualAtSlot(kind);
  const { data } = useRecipes(true);
  const rows: UsualRow[] = usual.map((u) => ({
    kind: u.kind,
    id: u.id,
    name: u.name,
    sub: u.serving_label ?? undefined,
    kcal: u.kcal != null ? `${u.kind === 'recipe' ? '~' : ''}${fmtKcal(u.kcal)} kcal` : undefined,
  }));
  for (const rec of (data?.recipes ?? []).filter((r) => r.servings === 1)) {
    if (rows.some((r) => r.kind === 'recipe' && r.id === rec.recipe_id)) continue;
    rows.push({
      kind: 'recipe',
      id: rec.recipe_id,
      name: rec.name,
      sub:
        rec.ingredients
          .map((i) => i.name.split(',')[0])
          .slice(0, 4)
          .join(' · ') || undefined,
      kcal:
        typeof rec.macros_per_serving.kcal === 'number' ? `${fmtKcal(rec.macros_per_serving.kcal)} kcal` : undefined,
    });
  }
  return rows;
}

export function MealUsualList({
  kind,
  planned,
  busy,
  onAddFood,
  onAddRecipe,
  onAddPlanned,
}: {
  kind: MealKind;
  /** The week's menu for this slot, when there is one. */
  planned?: { name: string } | null;
  busy?: boolean;
  onAddFood: (foodId: string) => void;
  onAddRecipe: (recipeId: string) => void;
  onAddPlanned?: () => void;
}) {
  const rows = useUsualRows(kind);
  if (!planned && rows.length === 0) return null;
  return (
    <div className="ms-usual" aria-label={`Your usual ${kind}`}>
      {planned && onAddPlanned && (
        <FoodPickRow name={planned.name} sub="from your week’s plan" tone="planned" busy={busy} onAdd={onAddPlanned} />
      )}
      {rows.map((r) => (
        <FoodPickRow
          key={`${r.kind}-${r.id}`}
          name={r.name}
          sub={r.sub}
          kcal={r.kcal}
          busy={busy}
          onAdd={() => (r.kind === 'recipe' ? onAddRecipe(r.id) : onAddFood(r.id))}
        />
      ))}
    </div>
  );
}
