/**
 * The one-food express lane (meal-logging rework, 1b ruling: "the ＋ sheet keeps a direct one
 * thing row that skips the meal screen and writes a single-item meal"). Search, pick, one
 * confirm, one closed write — nobody is forced through a container they don't want.
 *
 * This replaced the old Log screen as the single-food surface when the meal became the screen:
 * everything meal-shaped lives on MealScreen; this lane is deliberately tiny and writes through
 * the same `logMealFromFood` the quick-add rows use. The drink composer keeps its door here —
 * a drink is the one "several things" log that is not a meal.
 */
import { useEffect, useState } from 'react';
import type { Food, MealKind } from '@cadence/shared';
import { getFoodById, getFoodRecents, logMealFromFood, searchFoods, type FoodSummary } from '../../lib/api.ts';
import { useInvalidateNutritionDay } from '../../lib/query/index.ts';
import { AddFoodSheet } from './AddFoodSheet.tsx';
import { DrinkComposer } from './DrinkComposer.tsx';
import { FoodPickHead, FoodPickRow } from './FoodPickRow.tsx';

export function ExpressFood({
  meal,
  onClose,
  onLogged,
}: {
  meal?: MealKind;
  onClose: () => void;
  onLogged?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodSummary[]>([]);
  const [recents, setRecents] = useState<FoodSummary[]>([]);
  const [picked, setPicked] = useState<Food | null>(null);
  const [drink, setDrink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const invalidate = useInvalidateNutritionDay();

  useEffect(() => {
    let alive = true;
    getFoodRecents()
      .then((r) => alive && r.status === 'ok' && setRecents(r.foods.slice(0, 6)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) return setResults([]);
    let alive = true;
    const t = setTimeout(() => {
      searchFoods(q)
        .then((r) => alive && r.status === 'ok' && setResults(r.foods.slice(0, 12)))
        .catch(() => {});
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);

  async function pick(id: string) {
    setErr('');
    const r = await getFoodById(id);
    if (r.status !== 'ok') return setErr("Couldn't open that food just now — try again.");
    setPicked(r.food);
  }

  async function log(portion: { servingIndex: number; quantity: number; meal: MealKind }) {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const logged = await logMealFromFood({
        food_id: picked!.food_id,
        serving_index: portion.servingIndex,
        quantity: portion.quantity,
        meal: portion.meal,
      });
      if (!logged) return setErr("Couldn't log that just now — try again in a moment.");
      await invalidate();
      onLogged?.();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  if (drink) {
    return (
      <DrinkComposer
        onBack={() => setDrink(false)}
        onLogged={() => {
          onLogged?.();
          onClose();
        }}
      />
    );
  }

  if (picked) {
    return (
      <AddFoodSheet
        food={picked}
        meal={meal ?? 'snack'}
        busy={busy}
        err={err}
        onLog={(portion) => void log(portion)}
        onBack={() => setPicked(null)}
      />
    );
  }

  return (
    <div className="fl" role="region" aria-label="Log one food">
      <div className="fl-head">
        <button className="fh-back" onClick={onClose} aria-label="Back">
          ‹
        </button>
        <b>One thing</b>
      </div>
      <div className="fl-body">
        <div className="fl-search">
          <input
            className="fl-search-in"
            autoFocus
            value={query}
            placeholder="Search foods, brands…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {err && <div className="fl-note">{err}</div>}
        {query.trim() ? (
          <div className="fl-results">
            {results.map((f) => (
              <FoodPickRow
                key={f.food_id}
                name={f.name}
                sub={[f.brand, f.serving_label].filter(Boolean).join(' · ')}
                tone="plain"
                onAdd={() => void pick(f.food_id)}
              />
            ))}
            {!results.length && <div className="fl-note">Nothing by that name yet.</div>}
          </div>
        ) : (
          <>
            {recents.length > 0 && (
              <div className="fq">
                <FoodPickHead label="RECENTLY EATEN" />
                {recents.map((f) => (
                  <FoodPickRow
                    key={f.food_id}
                    name={f.name}
                    sub={[f.brand, f.serving_label].filter(Boolean).join(' · ')}
                    tone="plain"
                    onAdd={() => void pick(f.food_id)}
                  />
                ))}
              </div>
            )}
            <button className="fl-drink" onClick={() => setDrink(true)}>
              Several things in one drink? ›
            </button>
          </>
        )}
      </div>
    </div>
  );
}
