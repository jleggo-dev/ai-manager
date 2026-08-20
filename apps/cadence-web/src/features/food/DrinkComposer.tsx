import { useState } from 'react';
import { macrosForLog, type Food } from '@cadence/shared';
import { getFoodById, logMealFromItems, logWater, searchFoods, type FoodSummary, type Meal } from '../../lib/api.ts';
import { useInvalidateNutritionDay } from '../../lib/query/index.ts';
import { GLASS_ML } from '../nutrition/WaterRow.tsx';
import { macroLineProteinFirst } from './amounts.ts';

const round2 = (n: number): number => Math.round(n * 100) / 100;

interface DrinkItem {
  food: Food;
  quantity: number;
}

/** "Counts as two glasses of water too" — the credit, in the glass this app already counts in. */
export function waterCreditLine(ml: number): string {
  const glasses = Math.round((ml / GLASS_ML) * 10) / 10;
  const whole = Number.isInteger(glasses) ? String(glasses) : glasses.toFixed(1);
  return `Counts as ${whole} glass${glasses === 1 ? '' : 'es'} of water too — ${ml} ml, and a glass is ${GLASS_ML}.`;
}

/**
 * A drink of several things (design 07) — a water base with things stirred into it. It is one
 * meal, not three logs, and the water in it counts as water, because a recovery drink after a hot
 * run is both. Nothing here is judged: the numbers are shown so they are known, never so they are
 * avoided.
 *
 * The micronutrient read the design draws alongside ("+300 mg sodium — that's the point of it")
 * belongs to the Nutrients drill-down and is not built here.
 */
export function DrinkComposer({ onLogged, onBack }: { onLogged: (meal: Meal | null) => void; onBack: () => void }) {
  const [ml, setMl] = useState(GLASS_ML * 2);
  const [items, setItems] = useState<DrinkItem[]>([]);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<FoodSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const invalidateNutritionDay = useInvalidateNutritionDay();

  const total = items.reduce(
    (acc, it) => {
      const m = macrosForLog(it.food, { quantity: it.quantity });
      return {
        kcal: acc.kcal + (m.kcal ?? 0),
        protein_g: acc.protein_g + (m.protein_g ?? 0),
        carbs_g: acc.carbs_g + (m.carbs_g ?? 0),
        fat_g: acc.fat_g + (m.fat_g ?? 0),
      };
    },
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );

  async function look(q: string) {
    setQuery(q);
    if (!q.trim()) return setFound([]);
    const r = await searchFoods(q);
    setFound(r.foods.slice(0, 5));
  }

  async function add(foodId: string) {
    const r = await getFoodById(foodId);
    if (r.status !== 'ok' || !r.food) return setErr("Couldn't open that one — try another.");
    setItems((prev) => [...prev, { food: r.food!, quantity: 1 }]);
    setQuery('');
    setFound([]);
  }

  async function log() {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const logged = items.length
        ? await logMealFromItems({
            items: items.map((it) => ({ food_id: it.food.food_id, serving_index: it.food.default_serving ?? 0, quantity: it.quantity })),
            meal: 'drink',
          })
        : null;
      if (items.length && !logged) {
        setErr("Couldn't write that down just now — try again in a moment.");
        return;
      }
      if (ml > 0) await logWater(ml);
      await invalidateNutritionDay();
      onLogged(logged);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fd">
      <div className="fd-head">
        <button type="button" className="fd-back" aria-label="Back" onClick={onBack}>
          ‹
        </button>
        <h2>A drink, mixed</h2>
        <span />
      </div>

      <div className="fd-card">
        <div className="fa-row">
          <div className="fa-row-t">
            <span className="fa-row-n">
              <b>Water</b>
            </span>
            <span className="fa-row-s">the base · a glass is {GLASS_ML} ml</span>
          </div>
          <div className="fa-step">
            <button type="button" aria-label="Less water" disabled={busy || ml <= 0} onClick={() => setMl((v) => Math.max(0, v - GLASS_ML))}>
              −
            </button>
            <b>{ml} ml</b>
            <button type="button" aria-label="More water" disabled={busy} onClick={() => setMl((v) => v + GLASS_ML)}>
              +
            </button>
          </div>
        </div>

        {items.map((it, i) => (
          <div className="fa-row" key={`${it.food.food_id}-${i}`}>
            <div className="fa-row-t">
              <span className="fa-row-n">
                <b>{it.food.name}</b>
              </span>
              <span className="fa-row-s">
                {[it.food.servings[it.food.default_serving ?? 0]?.label, `${Math.round(macrosForLog(it.food, { quantity: it.quantity }).kcal ?? 0)} kcal`]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <div className="fa-step">
              <button
                type="button"
                aria-label={`Less ${it.food.name}`}
                disabled={busy || it.quantity <= 0.25}
                onClick={() => setItems((p) => p.map((x, j) => (j === i ? { ...x, quantity: Math.max(0.25, round2(x.quantity - 0.25)) } : x)))}
              >
                −
              </button>
              <b>{it.quantity}</b>
              <button
                type="button"
                aria-label={`More ${it.food.name}`}
                disabled={busy}
                onClick={() => setItems((p) => p.map((x, j) => (j === i ? { ...x, quantity: round2(x.quantity + 0.25) } : x)))}
              >
                +
              </button>
            </div>
            <button type="button" className="fa-row-x" aria-label={`Remove ${it.food.name}`} disabled={busy} onClick={() => setItems((p) => p.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        ))}

        <div className="fd-add">
          <input
            className="wiz-in"
            value={query}
            aria-label="Something else in it"
            placeholder="＋ Something else in it"
            disabled={busy}
            onChange={(e) => void look(e.target.value)}
          />
          {found.map((f) => (
            <button type="button" key={f.food_id} className="fa-chip" disabled={busy} onClick={() => void add(f.food_id)}>
              {f.name}
            </button>
          ))}
        </div>
      </div>

      <div className="fa-tot">
        <b>{Math.round(total.kcal)} kcal</b>
        <span>{macroLineProteinFirst(total)}</span>
      </div>

      {ml > 0 && <p className="fd-note">{waterCreditLine(ml)}</p>}
      {err && <div className="food-empty">{err}</div>}

      <button type="button" className="fa-log" disabled={busy || (!items.length && ml <= 0)} onClick={() => void log()}>
        {busy ? 'Writing it down…' : 'Log the drink'}
      </button>
    </div>
  );
}
