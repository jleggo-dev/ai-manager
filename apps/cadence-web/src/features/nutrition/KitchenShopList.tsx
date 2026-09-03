import { useEffect, useMemo, useRef, useState } from 'react';
import { deriveShoppingList, type MealPlanDay, type Recipe, type ShoppingListItem } from '@cadence/shared';
import { groupByAisle } from './aisles.ts';
import { plannedRecipes } from './kitchenPlan.ts';

/**
 * The shopping list (Food Journey 10c) — the LIST is generated, the TICKS are kept.
 *
 * The list is worked out from whatever the week plans, every time this opens, and its rows are
 * never written back — change Wednesday's dinner and the list is simply different next time you
 * look, with no reconciliation step and no note explaining why it disagrees with the plan.
 *
 * The ticks persist (owner ruling, 2026-09-02: the original session-only ticks lost the basket to
 * a phone lock mid-shop). Every toggle writes the derived list with its checked flags onto the
 * plan row; the next derive reads back only the checkmarks, matched by item name. A new week is a
 * new plan row, so the basket empties itself when the week turns.
 */
export function KitchenShopList({
  days,
  byId,
  savedTicks,
  onSaveTicks,
  onPlanWeek,
}: {
  days: MealPlanDay[];
  byId: Map<string, Recipe>;
  /** The plan row's stored list — read for `checked` by name, nothing else. */
  savedTicks: ShoppingListItem[];
  onSaveTicks: (list: ShoppingListItem[]) => void;
  onPlanWeek: () => void;
}) {
  const list = useMemo(() => deriveShoppingList(plannedRecipes(days, byId)), [days, byId]);
  const [got, setGot] = useState<Set<string>>(() => new Set(savedTicks.filter((i) => i.checked).map((i) => i.name)));
  // A shop opened straight from a deep link mounts before the plan row lands — seed the basket
  // ONCE when it does, and never again, so a server echo can't undo a tick made in the aisle.
  const seeded = useRef(savedTicks.length > 0);
  useEffect(() => {
    if (seeded.current || savedTicks.length === 0) return;
    seeded.current = true;
    setGot(new Set(savedTicks.filter((i) => i.checked).map((i) => i.name)));
  }, [savedTicks]);

  const groups = groupByAisle(list.map((i) => ({ ...i, checked: got.has(i.name) })));
  const inBasket = list.filter((i) => got.has(i.name)).length;
  const left = list.length - inBasket;

  function toggle(name: string) {
    const next = new Set(got);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setGot(next);
    onSaveTicks(list.map((i) => ({ name: i.name, qty: i.qty ?? '1', category: 'other', checked: next.has(i.name) })));
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
        <span>WORKED OUT FROM THIS WEEK</span>
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
