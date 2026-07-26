/**
 * Shopping list for a saved meal plan — check items; PATCH persists quietly.
 */
import { useState } from 'react';
import type { ShoppingListItem } from '@cadence/shared';
import { patchMealPlan, shoppingListSummary, type MealPlanRecord } from '../../lib/api.ts';

export function MealPlanShoppingList({
  plan,
  onUpdated,
}: {
  plan: MealPlanRecord;
  onUpdated: (plan: MealPlanRecord) => void;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState('');

  async function toggle(index: number) {
    if (!plan.meal_plan_id || busyKey) return;
    const next: ShoppingListItem[] = plan.shopping_list.map((item, i) =>
      i === index ? { ...item, checked: !item.checked } : item,
    );
    const key = `${index}-${next[index]?.checked}`;
    setBusyKey(key);
    setErr('');
    onUpdated({ ...plan, shopping_list: next });
    try {
      const result = await patchMealPlan(plan.meal_plan_id, { shopping_list: next });
      if (result.status !== 'ok') {
        onUpdated(plan);
        setErr(result.message);
        return;
      }
      onUpdated(result.plan);
    } finally {
      setBusyKey(null);
    }
  }

  if (!plan.shopping_list.length) {
    return <div className="food-empty">No shopping list on this week yet.</div>;
  }

  const byCat = new Map<string, { item: ShoppingListItem; index: number }[]>();
  plan.shopping_list.forEach((item, index) => {
    const cat = item.category?.trim() || 'other';
    const rows = byCat.get(cat) ?? [];
    rows.push({ item, index });
    byCat.set(cat, rows);
  });

  return (
    <div className="food-shopping" role="region" aria-label="Shopping list">
      <div className="food-panel-t">Shopping list</div>
      <p className="food-panel-p">{shoppingListSummary(plan.shopping_list)}</p>
      {err && <div className="food-empty">{err}</div>}
      {[...byCat.entries()].map(([cat, rows]) => (
        <div key={cat} style={{ marginBottom: 10 }}>
          <div className="plan-week-label" style={{ textTransform: 'capitalize' }}>
            {cat}
          </div>
          <ul className="food-list">
            {rows.map(({ item, index }) => (
              <li key={`${item.name}-${index}`}>
                <label className="food-row" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    disabled={!!busyKey}
                    onChange={() => void toggle(index)}
                    aria-label={`${item.checked ? 'Uncheck' : 'Check'} ${item.name}`}
                  />
                  <span style={{ marginLeft: 10 }}>
                    <b style={{ textDecoration: item.checked ? 'line-through' : undefined }}>{item.name}</b>
                    {item.qty ? <span> · {item.qty}</span> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
