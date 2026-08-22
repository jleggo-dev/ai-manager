import { useMemo, useState } from 'react';
import { deriveShoppingList, type MealPlanDay, type Recipe } from '@cadence/shared';
import { groupByAisle } from './aisles.ts';
import { plannedRecipes } from './kitchenPlan.ts';

/**
 * The shopping list (Food Journey 10c) — **generated, never kept**.
 *
 * It is worked out from whatever the week plans, every time this opens, and nothing about it is
 * written back. That is the whole design ruling and it buys one specific thing: a list can never be
 * stale. Change Wednesday's dinner and the list is simply different next time you look, with no
 * reconciliation step and no note explaining why it disagrees with the plan.
 *
 * Ticks live here and only here, for the length of a shop. Persisting them would be keeping the
 * list, which is the thing the ruling says not to do — and the saved week's own list, over in the
 * shop, is the surface that does remember.
 */
export function KitchenShopList({
  days,
  byId,
  onPlanWeek,
}: {
  days: MealPlanDay[];
  byId: Map<string, Recipe>;
  onPlanWeek: () => void;
}) {
  const list = useMemo(() => deriveShoppingList(plannedRecipes(days, byId)), [days, byId]);
  const [got, setGot] = useState<Set<string>>(new Set());

  const groups = groupByAisle(list.map((i) => ({ ...i, checked: got.has(i.name) })));
  const inBasket = list.filter((i) => got.has(i.name)).length;
  const left = list.length - inBasket;

  function toggle(name: string) {
    setGot((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  if (list.length === 0) {
    return (
      <div className="kt-plan" role="region" aria-label="Shopping list">
        <div className="kt-msg">
          Plan a few meals and I&apos;ll work out what to buy.
          <button className="kt-inline" onClick={onPlanWeek}>
            Plan the week
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="kt-plan" role="region" aria-label="Shopping list">
      <div className="kt-shop-head">
        <b>
          {left} thing{left === 1 ? '' : 's'} left
        </b>
        <span>WORKED OUT FROM THIS WEEK — NOT SAVED</span>
      </div>
      {groups.map((g) => (
        <div className="kt-aisle" key={g.label}>
          <div className="kt-aisle-l">{g.label}</div>
          {g.rows.map(({ item }) => (
            <button
              key={item.name}
              className={`kt-shoprow${item.checked ? ' is-checked' : ''}`}
              onClick={() => toggle(item.name)}
            >
              <span className="kt-check" aria-hidden>
                {item.checked ? '✓' : ''}
              </span>
              <span className="kt-shopname">{item.name}</span>
              {item.qty && <span className="kt-shopqty">{item.qty}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
