import { FoodPickHead, FoodPickRow } from '../../food/FoodPickRow.tsx';
import { MethodTiles, type CaptureMethod } from '../../food/MethodTiles.tsx';
import type { UsualAtSlot } from '../../../lib/api.ts';
import type { MealKind } from '../../../lib/api.ts';
import type { PlannedMeal } from './usePlannedMeal.ts';

const kcal = (n: number | null, approx = false): string | undefined =>
  n == null ? undefined : `${approx ? '~' : ''}${Math.round(n)} kcal`;

const times = (n: number): string => `logged ${n} time${n === 1 ? '' : 's'}`;

/**
 * Quick add, slot-aware (design 05a). It stays because it is the fastest path and most logging is
 * repetition — but a list of everything eaten today is the wrong list at 08:14, so this one is
 * scoped to the slot: what the week planned for it first, then what they usually have AT it,
 * counted. Every method is a tile, so nothing here is a dead end.
 */
export function QuickAddBody({
  mealKind,
  planned,
  usual,
  busy,
  onMethod,
  onPhoto,
  onLogRecipe,
  onAddFood,
}: {
  mealKind: MealKind;
  planned: PlannedMeal | null;
  usual: UsualAtSlot[];
  busy: boolean;
  onMethod: (m: CaptureMethod) => void;
  onPhoto: (file: File | undefined) => void;
  onLogRecipe: (recipeId: string) => void;
  onAddFood: (foodId: string) => void;
}) {
  const methods: CaptureMethod[] = ['chat', 'voice', 'picture', 'barcode', 'search'];
  return (
    <div className="fq">
      <MethodTiles methods={methods} disabled={busy} onPick={onMethod} onPhoto={onPhoto} />

      {planned && (
        <>
          <FoodPickHead label={`PLANNED FOR ${mealKind.toUpperCase()}`} />
          <FoodPickRow
            name={planned.name}
            sub="from your week’s plan"
            tone="planned"
            busy={busy}
            onAdd={() => onLogRecipe(planned.recipe_id)}
          />
        </>
      )}

      {usual.length > 0 && (
        <>
          <FoodPickHead label={`YOU USUALLY HAVE AT ${mealKind.toUpperCase()}`} />
          {usual.map((u) => (
            <FoodPickRow
              key={`${u.kind}-${u.id}`}
              name={u.name}
              sub={[u.serving_label, times(u.count)].filter(Boolean).join(' · ')}
              kcal={kcal(u.kcal, u.kind === 'recipe')}
              busy={busy}
              onAdd={() => (u.kind === 'recipe' ? onLogRecipe(u.id) : onAddFood(u.id))}
            />
          ))}
        </>
      )}

      <div className="fq-foot">
        Anything not on this list — search it, say it, or photograph it. The numbers come with it either way.
      </div>
    </div>
  );
}
