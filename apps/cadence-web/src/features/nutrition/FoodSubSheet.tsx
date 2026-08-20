import { MealPlansPanel } from '../food/MealPlansPanel.tsx';
import { RecipesPanel } from '../food/RecipesPanel.tsx';
import { ShopSheet } from './ShopSheet.tsx';
import { WeekMenuSheet } from './WeekMenuSheet.tsx';
import type { FoodHomeSub } from './foodHomeSub.ts';

/**
 * The Food screen's sub-tools in one hosted sheet (Food Journey 02) — this week's menu, the
 * shopping list, the cookbook and the planner all open over the screen rather than replacing it,
 * so the way back is always the same gesture.
 */
export function FoodSubSheet({
  sub,
  onClose,
  onOpen,
  onLogged,
}: {
  sub: Exclude<FoodHomeSub, null>;
  onClose: () => void;
  onOpen: (sub: FoodHomeSub) => void;
  onLogged: () => void;
}) {
  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet tf" role="dialog" aria-label="Food tools">
        <div className="sheet-grab" aria-hidden />
        <div className="tf-sub">
          {sub === 'shop' ? (
            <ShopSheet onClose={onClose} />
          ) : sub === 'week' ? (
            <WeekMenuSheet onOpenShop={() => onOpen('shop')} onClose={onClose} />
          ) : sub === 'plan' ? (
            <MealPlansPanel onClose={onClose} />
          ) : (
            <RecipesPanel onClose={onClose} onLogged={onLogged} onOpenMealPlans={() => onOpen('plan')} />
          )}
        </div>
      </div>
    </>
  );
}
