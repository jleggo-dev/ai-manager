import { useState } from 'react';
import {
  mealTotals,
  macrosForLog,
  resolveDefaultServing,
  type MealPlanItem,
  type MealPlanSlotKind,
  type Recipe,
} from '@cadence/shared';
import { searchFoods, getFoodById, type FoodSummary } from '../../lib/api.ts';
import { KITCHEN_SLOTS, SLOT_LABEL, dayLabel } from './kitchenPlan.ts';

/**
 * Frame 10a — define a meal once, then say when you'll eat it.
 *
 * *"Define a meal once — recipes, food, or both — then say which day and which meal it is."* The
 * three numbered steps are the design's, and the order is load-bearing: a meal nobody assigned is
 * just a list, so the screen does not let you build one and walk away.
 *
 * WHY LOOSE FOODS MATTER HERE. The first version of the Kitchen could only put a saved recipe on a
 * slot, and most dinners are not one recipe: they are a main, a side, and the oil it was cooked in.
 * Frame 10a shows exactly that — chicken thighs and lemon orzo, a rocket salad, a tablespoon of
 * olive oil, totalling 674 kcal.
 *
 * The running total is *"added up from the three items"* — it says how many it counted, because an
 * item whose macros we do not have contributes nothing and pretending otherwise is how a plan
 * quietly reads 0 kcal. Same rule as the food log learned on 2026-08-20.
 *
 * PREP, NOT LOGGING. Nothing here writes to the food log; it writes an intention onto a day. The
 * save button says where it is going ("Save & put on Wednesday dinner") rather than "Log", and that
 * is not just copy — it is the ruling this whole tab exists under.
 */
export function MealComposer({
  recipes,
  weekDays,
  initialDay,
  initialSlot,
  onSave,
  onCancel,
}: {
  recipes: Recipe[];
  weekDays: string[];
  initialDay?: string;
  initialSlot?: MealPlanSlotKind;
  onSave: (day: string, slot: MealPlanSlotKind, meal: { name?: string; items: MealPlanItem[] }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [items, setItems] = useState<MealPlanItem[]>([]);
  const [day, setDay] = useState(initialDay ?? weekDays[0] ?? '');
  const [slot, setSlot] = useState<MealPlanSlotKind>(initialSlot ?? 'dinner');
  const [picking, setPicking] = useState<'none' | 'recipe' | 'food'>('none');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<FoodSummary[]>([]);

  const totals = mealTotals({ slot, items });
  const uncounted = totals.items - totals.counted;

  const addRecipe = (r: Recipe) => {
    const per = r.macros_per_serving ?? {};
    setItems((xs) => [
      ...xs,
      {
        kind: 'recipe',
        id: r.recipe_id,
        name: r.name,
        qty: 1,
        unit: 'serving',
        kcal: per.kcal,
        protein_g: per.protein_g,
        carbs_g: per.carbs_g,
        fat_g: per.fat_g,
      },
    ]);
    setPicking('none');
  };

  /**
   * Search returns names only, so the full food is fetched for its macros. Worth the extra call:
   * without it every food would land uncounted and the meal total would understate itself — which
   * is the same failure as a confident zero, just quieter.
   */
  const addFood = async (f: FoodSummary) => {
    setPicking('none');
    setQuery('');
    setFound([]);
    const full = await getFoodById(f.food_id).catch(() => null);
    const food = full?.status === 'ok' ? full.food : null;
    // `macrosForLog` is the app's own serving arithmetic (base × serving factor × quantity). Doing
    // it by hand here would be a second implementation of the thing the food log already relies on.
    const per = food ? macrosForLog(food) : undefined;
    const serving = food ? resolveDefaultServing(food) : null;
    setItems((xs) => [
      ...xs,
      {
        kind: 'food',
        id: f.food_id,
        name: f.name,
        qty: 1,
        unit: serving?.label ?? 'serving',
        kcal: per?.kcal,
        protein_g: per?.protein_g,
        carbs_g: per?.carbs_g,
        fat_g: per?.fat_g,
      },
    ]);
  };

  return (
    <div className="kt-plan" role="region" aria-label="Define a meal">
      <p className="kt-lede">Define a meal once — recipes, food, or both — then say which day and which meal it is.</p>

      <section className="kt-step" aria-label="The meal">
        <h4 className="kt-step-h">1 · The meal</h4>
        <input
          className="mc-cap-in"
          value={name}
          aria-label="What to call this meal"
          placeholder="what you'd call it — “thighs, orzo & a side salad”"
          onChange={(e) => setName(e.target.value)}
        />

        <ul className="kt-items">
          {items.map((it, i) => (
            <li key={`${it.kind}-${it.id}-${i}`} className="kt-item">
              <span className="kt-item-kind">{it.kind === 'recipe' ? 'Recipe' : 'Food'}</span>
              <span className="kt-item-name">{it.name}</span>
              <span className="kt-item-amt">
                {it.qty} {it.unit ?? ''}
              </span>
              <span className="kt-item-kcal">{it.kcal == null ? '—' : `${Math.round(it.kcal)} kcal`}</span>
              <button
                type="button"
                className="kt-item-x"
                aria-label={`Take ${it.name} out`}
                onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        {picking === 'none' ? (
          <div className="kt-addrow">
            <button type="button" className="kt-add" onClick={() => setPicking('recipe')}>
              ＋ Add a recipe
            </button>
            <button type="button" className="kt-add" onClick={() => setPicking('food')}>
              ＋ Add a food
            </button>
          </div>
        ) : picking === 'recipe' ? (
          <ul className="kt-pick" aria-label="Your recipes">
            {recipes.length === 0 && <li className="kt-empty">No saved recipes yet — paste one in first.</li>}
            {recipes.map((r) => (
              <li key={r.recipe_id}>
                <button type="button" onClick={() => addRecipe(r)}>
                  {r.name}
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="kt-cancel" onClick={() => setPicking('none')}>
                Never mind
              </button>
            </li>
          </ul>
        ) : (
          <div className="kt-pick" role="group" aria-label="Find a food">
            <input
              className="mc-cap-in"
              value={query}
              aria-label="Search your foods"
              placeholder="search your foods"
              onChange={(e) => {
                setQuery(e.target.value);
                void searchFoods(e.target.value).then((r) => setFound((r.foods ?? []).slice(0, 8)));
              }}
            />
            <ul>
              {found.map((f) => (
                <li key={f.food_id}>
                  <button type="button" onClick={() => void addFood(f)}>
                    {f.name}
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="kt-cancel" onClick={() => setPicking('none')}>
              Never mind
            </button>
          </div>
        )}

        {items.length > 0 && (
          <div className="kt-total">
            <strong>{totals.kcal || '—'}</strong> kcal
            <span className="kt-total-macros">
              {totals.protein_g}g protein · {totals.carbs_g}g carbs · {totals.fat_g}g fat
            </span>
            <span className="kt-total-note">
              {uncounted > 0
                ? `added up from ${totals.counted} of the ${totals.items} items`
                : `added up from the ${totals.items} items`}
            </span>
          </div>
        )}
      </section>

      <section className="kt-step" aria-label="Which day">
        <h4 className="kt-step-h">2 · Which day</h4>
        <div className="kt-days">
          {weekDays.map((d) => (
            <button
              key={d}
              type="button"
              className={d === day ? 'kt-chip on' : 'kt-chip'}
              aria-pressed={d === day}
              onClick={() => setDay(d)}
            >
              {dayLabel(d)}
            </button>
          ))}
        </div>
      </section>

      <section className="kt-step" aria-label="Which meal">
        <h4 className="kt-step-h">3 · Which meal</h4>
        <div className="kt-days">
          {KITCHEN_SLOTS.map((s) => (
            <button
              key={s}
              type="button"
              className={s === slot ? 'kt-chip on' : 'kt-chip'}
              aria-pressed={s === slot}
              onClick={() => setSlot(s)}
            >
              {SLOT_LABEL[s]}
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        className="fa-log"
        disabled={items.length === 0 || !day}
        onClick={() => onSave(day, slot, { name: name.trim() || undefined, items })}
      >
        {items.length === 0
          ? 'Add something first'
          : `Save & put on ${dayLabel(day)} ${SLOT_LABEL[slot].toLowerCase()}`}
      </button>
      <button type="button" className="lockbtn ghost" onClick={onCancel}>
        Back
      </button>
    </div>
  );
}
