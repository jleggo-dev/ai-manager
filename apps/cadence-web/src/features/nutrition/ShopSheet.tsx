import { useEffect, useState } from 'react';
import type { ShoppingListItem } from '@cadence/shared';
import { getCurrentMealPlan, patchMealPlan, type MealPlanRecord } from '../../lib/api.ts';

/** Store-shaped aisle order + labels — the design's PRODUCE / BUTCHER / TINS & DRY / DAIRY (G). */
const AISLES: Array<{ key: string; label: string }> = [
  { key: 'produce', label: 'PRODUCE' },
  { key: 'protein', label: 'BUTCHER & PROTEIN' },
  { key: 'pantry', label: 'TINS & DRY' },
  { key: 'dairy', label: 'DAIRY' },
  { key: 'frozen', label: 'FROZEN' },
  { key: 'bakery', label: 'BAKERY' },
  { key: 'other', label: 'ANYTHING ELSE' },
];

function groupByAisle(
  list: ShoppingListItem[],
): Array<{ label: string; rows: Array<{ item: ShoppingListItem; index: number }> }> {
  const byCat = new Map<string, Array<{ item: ShoppingListItem; index: number }>>();
  list.forEach((item, index) => {
    const cat = (item.category?.toString().trim() || 'other').toLowerCase();
    const key = AISLES.some((a) => a.key === cat) ? cat : 'other';
    const rows = byCat.get(key) ?? [];
    rows.push({ item, index });
    byCat.set(key, rows);
  });
  return AISLES.filter((a) => byCat.has(a.key)).map((a) => ({ label: a.label, rows: byCat.get(a.key) ?? [] }));
}

/**
 * The shop (design G) — the week's shopping list as an aisle-grouped checklist, grouped the way the
 * store is. Check as you go; each toggle PATCHes quietly and survives leaving. "Review & finish" is the
 * one commit. Reuses the saved meal plan's `shopping_list` + `patchMealPlan` — no new backend. (The
 * shop as a *trail task* — a real occurrence — is the deeper piece that follows; this is the tool it runs.)
 */
export function ShopSheet({ onClose }: { onClose: () => void }) {
  const [plan, setPlan] = useState<MealPlanRecord | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'empty' | 'error'>('loading');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getCurrentMealPlan().then((r) => {
      if (!alive) return;
      if (r.status === 'ok' && r.plan) {
        setPlan(r.plan);
        setStatus(r.plan.shopping_list.length ? 'ok' : 'empty');
      } else {
        setStatus(r.status === 'unavailable' || r.status === 'error' ? 'error' : 'empty');
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  async function toggle(index: number) {
    if (!plan?.meal_plan_id || busy) return;
    const next = plan.shopping_list.map((it, i) => (i === index ? { ...it, checked: !it.checked } : it));
    setPlan({ ...plan, shopping_list: next });
    setBusy(true);
    try {
      const r = await patchMealPlan(plan.meal_plan_id, { shopping_list: next });
      if (r.status === 'ok') setPlan(r.plan);
    } finally {
      setBusy(false);
    }
  }

  const total = plan?.shopping_list.length ?? 0;
  const inBasket = plan?.shopping_list.filter((i) => i.checked).length ?? 0;
  const left = total - inBasket;
  const groups = plan ? groupByAisle(plan.shopping_list) : [];

  return (
    <div className="shop">
      <div className="shop-head">
        <button className="shop-back" onClick={onClose} aria-label="Back">
          ‹
        </button>
        <div className="shop-headt">
          <b>The shop</b>
          <span>
            {status === 'ok'
              ? `${left} thing${left === 1 ? '' : 's'} left · ${inBasket} of ${total} in the basket`
              : 'GROCERIES FROM THIS WEEK'}
          </span>
        </div>
      </div>

      {status === 'loading' ? (
        <div className="shop-msg">Loading the list…</div>
      ) : status === 'error' ? (
        <div className="shop-msg">{"Couldn't load the shop just now — plan a week's meals first, or try again."}</div>
      ) : status === 'empty' ? (
        <div className="shop-msg">No shopping list yet — plan a week of meals and I&apos;ll derive one.</div>
      ) : (
        <>
          {total > 0 && (
            <div className="shop-bar" aria-hidden>
              <div className="shop-bar-fill" style={{ width: `${Math.round((inBasket / total) * 100)}%` }} />
            </div>
          )}
          <div className="shop-list">
            {groups.map((g) => (
              <div className="shop-aisle" key={g.label}>
                <div className="shop-aisle-l">{g.label}</div>
                {g.rows.map(({ item, index }) => (
                  <button
                    key={`${item.name}-${index}`}
                    className={`shop-row${item.checked ? ' is-checked' : ''}`}
                    disabled={busy}
                    onClick={() => void toggle(index)}
                  >
                    <span className="shop-check" aria-hidden>
                      {item.checked ? '✓' : ''}
                    </span>
                    <span className="shop-name">{item.name}</span>
                    {item.qty && <span className="shop-qty">{item.qty}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <button className="shop-finish" onClick={onClose}>
            {left > 0 ? `Review & finish · ${left} unchecked ›` : 'All in the basket — finish ›'}
          </button>
        </>
      )}
    </div>
  );
}
