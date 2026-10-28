import { useEffect, useState } from 'react';
import { CoachFaceProvider } from '../coach/CoachFaceProvider.tsx';
import { CaptureSheet } from '../plan/CaptureSheet.tsx';
import { FOODS, itemOf, json, sum, type Item, type Part } from './mealPreviewFixtures.ts';

/**
 * `?preview=meal` (+ `&state=logged` | `&state=full` | `&state=planned`) — the trail's meal
 * capture, the quick log (2026-10-28), against a fixture draft, without auth, a plan, or the
 * API. The drawer's whole argument is how it reads on a phone, which is only judged by
 * looking; this is how it gets looked at. Every draft endpoint is answered in memory, so taps,
 * holds, the chips' × and "Log breakfast" all round-trip for real against the same contract
 * the server keeps (lib/api/meal-draft.ts). The cookbook holds a makes-four, and two days ago
 * a portion of it was logged — so the Leftovers shelf has something to say.
 *
 *   default  — an empty breakfast: the doors and the shelves, opening on Usual
 *   full     — three things in the cart, one amount still to settle
 *   logged   — a breakfast already logged, still taking adds
 *   planned  — the week names a dish for this slot: a Planned shelf, opening there
 */
export function MealCapturePreview() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(true);
  const state = new URLSearchParams(window.location.search).get('state') ?? 'empty';

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const meal: {
      log_id: string;
      date: string;
      meal: string;
      items: Item[];
      parts: Part[];
      macros: Record<string, number>;
      state: 'open' | 'closed';
      closes_at: string | null;
    } = {
      log_id: 'm-preview',
      date: today,
      meal: 'breakfast',
      items:
        state === 'full'
          ? [
              itemOf('f-skyr', 1.5),
              itemOf('f-blueberries'),
              { name: 'Chia seeds', unit: 'tbsp', est: { kcal: 58, protein_g: 2, carbs_g: 5, fat_g: 4 } },
            ]
          : state === 'logged'
            ? [itemOf('f-espresso'), itemOf('f-milk')]
            : [],
      parts: [],
      macros: {},
      state: state === 'logged' ? 'closed' : 'open',
      closes_at: state === 'logged' ? null : new Date(Date.now() + 2.5 * 3_600_000).toISOString(),
    };
    meal.macros = sum(meal.items);
    let partSeq = 0;

    const dayLogged = state === 'logged' ? [meal] : [];
    const day = () => {
      const totals = sum(dayLogged.flatMap((m) => m.items));
      return {
        date: today,
        meals: dayLogged.map((m) => ({ ...m })),
        totals,
        provisional_totals: {},
        confirmed_count: dayLogged.length,
        provisional_count: 0,
        targets: { kcal: 2150, protein_g: 160, carbs_g: 220, fat_g: 70 },
        left: { kcal: 2150 - (totals.kcal ?? 0) },
        burn_kcal: 0,
        eatback_kcal: 0,
        eatback_pct: 50,
        has_recent_food: true,
      };
    };

    const reply = () => json({ meal });
    const recipeOf = (id: string, name: string, servings: number, members: Item[]) => ({
      recipe_id: id,
      name,
      servings,
      ingredients: members.map((m) => ({ name: m.name, qty: m.qty ?? 1, ...(m.unit ? { unit: m.unit } : {}) })),
      steps: [],
      macros_per_serving: sum(members),
      tags: [],
      saved: true,
      source: 'user',
    });
    const BOWL = [itemOf('f-skyr'), itemOf('f-blueberries'), itemOf('f-granola', 0.5)];
    const STEW = [itemOf('f-oats', 2), itemOf('f-toast', 2)];
    /** The cookbook: a one-portion bowl, a makes-four stew, plus whatever "Name this recipe"
     *  mints in this session — the cookbook shelf and the usual shelf read them. */
    const savedRecipes: Array<Record<string, unknown> & { recipe_id: string; name: string; servings: number }> = [
      recipeOf('r-bowl', 'Chia bowl', 1, BOWL),
      recipeOf('r-stew', 'Lentil stew', 4, STEW),
      recipeOf('r-shak', 'Shakshuka', 2, [itemOf('f-eggs', 2), itemOf('f-toast')]),
    ];
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    /** The week behind: two days ago a portion of the stew — three of four left on the shelf. */
    const recentMeals = [
      {
        log_id: 'm-past-1',
        date: daysAgo(2),
        meal: 'dinner',
        items: STEW.map((it) => ({ ...it, part: 'pp1' })),
        parts: [{ key: 'pp1', name: 'Lentil stew', recipe_id: 'r-stew', yield_servings: 4, servings_logged: 1 }],
        macros: sum(STEW),
        state: 'closed',
      },
    ];
    const orig = window.fetch;
    window.fetch = (async (u: RequestInfo | URL, o?: RequestInit) => {
      const url = String(u);
      const path = url.replace(/^.*?\/api/, '');
      const body = o?.body ? (JSON.parse(String(o.body)) as Record<string, unknown>) : {};
      await new Promise((r) => setTimeout(r, 120));

      if (path.startsWith('/plan/occurrences/')) {
        return json({
          occurrence_id: 'occ-preview',
          title: 'Log breakfast',
          kind: 'system',
          status: meal.state === 'closed' ? 'done' : 'pending',
          date: today,
          category: 'nutrition',
          schedule: { time_of_day: '08:00' },
        });
      }
      if (path.startsWith('/nutrition/day')) return json(day());
      if (path === '/nutrition/meals/open') return json({ meal: meal.state === 'open' ? meal : null });
      if (path === '/nutrition/meals/draft') return reply();
      if (path.startsWith('/nutrition/meals/m-preview/')) {
        const verb = path.slice('/nutrition/meals/m-preview/'.length);
        if (verb === 'items') {
          if (typeof body.food_id === 'string') meal.items.push(itemOf(body.food_id, (body.quantity as number) ?? 1));
          else if (typeof body.recipe_id === 'string') {
            const key = `p${++partSeq}`;
            const recipe = savedRecipes.find((r) => r.recipe_id === body.recipe_id);
            const n = (body.servings as number | undefined) ?? 1;
            meal.parts.push({
              key,
              name: recipe?.name ?? 'Chia bowl',
              recipe_id: body.recipe_id,
              yield_servings: recipe?.servings ?? 1,
              servings_logged: n,
            });
            const members = body.recipe_id === 'r-stew' ? STEW : BOWL;
            const scale = n / (recipe?.servings ?? 1);
            meal.items.push(
              ...members.map(
                (it) =>
                  ({
                    ...it,
                    qty: Math.round((it.qty ?? 1) * scale * 100) / 100,
                    est: Object.fromEntries(Object.entries(it.est ?? {}).map(([k, v]) => [k, Math.round(v * scale)])),
                    part: key,
                  }) as Item,
              ),
            );
          } else if (Array.isArray(body.parsed)) meal.items.push(...(body.parsed as Item[]));
        } else if (verb === 'items/remove') meal.items.splice(body.index as number, 1);
        else if (verb === 'amount') {
          const it = meal.items[body.index as number];
          if (it) {
            const prev = it.qty && it.qty > 0 ? it.qty : 1;
            const factor = (body.qty as number) / prev;
            it.qty = body.qty as number;
            if (it.est) for (const k of Object.keys(it.est)) it.est[k] = Math.round(it.est[k]! * factor * 10) / 10;
          }
        } else if (verb === 'slot') meal.meal = body.meal as string;
        else if (verb === 'close') {
          meal.state = 'closed';
          meal.closes_at = null;
          if (!dayLogged.includes(meal)) dayLogged.push(meal);
        } else if (verb === 'parts') {
          if (body.op === 'group') {
            const key = `p${++partSeq}`;
            meal.parts.push({ key, name: (body.name as string) ?? null });
            for (const i of body.item_indexes as number[]) (meal.items[i] as Item & { part?: string }).part = key;
          } else if (body.op === 'ungroup') {
            meal.parts = meal.parts.filter((p) => p.key !== body.part);
            for (const it of meal.items as (Item & { part?: string })[]) if (it.part === body.part) delete it.part;
          } else if (body.op === 'rename') {
            const p = meal.parts.find((x) => x.key === body.part);
            if (p) p.name = body.name as string;
          }
        } else if (verb === 'save-part') {
          // Naming saves (owner, 2026-09-08): the part gets its name and a recipe_id, and the
          // recipe joins the cookbook and the shelf — the same round trip the server makes.
          const p = meal.parts.find((x) => x.key === body.part);
          if (p) {
            const members = (meal.items as (Item & { part?: string })[]).filter((it) => it.part === p.key);
            const recipe = {
              recipe_id: `r-saved-${p.key}`,
              name: String(body.name),
              servings: (body.yield_servings as number | undefined) ?? 1,
              ingredients: members.map((m) => ({ name: m.name, qty: m.qty ?? 1, ...(m.unit ? { unit: m.unit } : {}) })),
              steps: [],
              macros_per_serving: sum(members),
              tags: [],
              saved: true,
              source: 'user',
            };
            p.name = recipe.name;
            p.recipe_id = recipe.recipe_id;
            p.yield_servings = recipe.servings;
            p.servings_logged = p.servings_logged ?? recipe.servings;
            savedRecipes.push(recipe);
            return json({ recipe, meal });
          }
        }
        meal.macros = sum(meal.items);
        if (meal.state === 'closed') dayLogged.splice(0, dayLogged.length, meal);
        return reply();
      }
      if (path.startsWith('/nutrition/foods/usual')) {
        return json({
          items: [
            ...savedRecipes
              .filter((r) => r.servings === 1)
              .map((r) => ({
                kind: 'recipe',
                id: r.recipe_id,
                name: r.name,
                serving_label: `${(r.ingredients as unknown[]).length} ingredients`,
                kcal: (r.macros_per_serving as { kcal?: number }).kcal ?? null,
                count: 6,
              })),
            ...[
              'f-espresso',
              'f-milk',
              'f-blueberries',
              'f-strawberries',
              'f-skyr',
              'f-oats',
              'f-banana',
              'f-eggs',
              'f-toast',
              'f-pb',
              'f-honey',
              'f-granola',
            ].map((id, i) => ({
              kind: 'food',
              id,
              name: FOODS[id]!.name,
              serving_label: FOODS[id]!.label,
              kcal: FOODS[id]!.kcal,
              count: 12 - i,
            })),
          ],
        });
      }
      if (path.startsWith('/nutrition/foods/recents')) {
        return json({
          foods: ['f-skyr', 'f-blueberries', 'f-espresso'].map((id) => ({
            food_id: id,
            name: FOODS[id]!.name,
            brand: FOODS[id]!.brand,
            serving_label: FOODS[id]!.label,
            ambiguous: FOODS[id]!.ambiguous,
          })),
        });
      }
      if (path.startsWith('/nutrition/foods/search')) {
        const q = decodeURIComponent(path.split('q=')[1] ?? '').toLowerCase();
        return json({
          foods: Object.entries(FOODS)
            .filter(([, f]) => f.name.toLowerCase().includes(q))
            .map(([id, f]) => ({
              food_id: id,
              name: f.name,
              brand: f.brand,
              serving_label: f.label,
              ambiguous: f.ambiguous,
            })),
        });
      }
      if (/^\/nutrition\/foods\/f-/.test(path)) {
        const id = path.split('/').pop()!;
        const f = FOODS[id]!;
        return json({
          food_id: id,
          name: f.name,
          brand: f.brand,
          source: 'manual',
          base_unit: 'g',
          macros_per_base: { kcal: f.kcal, protein_g: f.p, carbs_g: f.c, fat_g: f.f },
          servings: [
            { label: f.label, unit: f.unit, amount_g: 100 },
            { label: '100 ml', unit: '100 ml', amount_g: 100 },
            { label: '1 cup, mashed (225g)', unit: 'cup', amount_g: 225 },
          ],
          default_serving: 0,
        });
      }
      if (path.startsWith('/nutrition/recipes')) return json({ status: 'ok', recipes: savedRecipes });
      if (path.startsWith('/nutrition/recent')) return json({ meals: [...dayLogged, ...recentMeals] });
      if (path.startsWith('/nutrition/meal-plans')) {
        if (state !== 'planned') return json({ status: 'ok', plan: null });
        return json({
          status: 'ok',
          plan: {
            meal_plan_id: 'mp-preview',
            week_of: daysAgo(new Date().getDay()),
            days: [
              {
                day: today,
                meals: [
                  {
                    slot: 'breakfast',
                    name: 'Overnight oats',
                    items: [
                      {
                        kind: 'food',
                        id: 'f-oats',
                        name: 'Rolled oats',
                        qty: 1,
                        unit: 'cup',
                        kcal: 150,
                        protein_g: 5,
                        carbs_g: 27,
                        fat_g: 3,
                      },
                      {
                        kind: 'food',
                        id: 'f-milk',
                        name: 'Milk, 2%',
                        qty: 1,
                        unit: 'cup',
                        kcal: 122,
                        protein_g: 8,
                        carbs_g: 12,
                        fat_g: 5,
                      },
                      { kind: 'food', id: 'f-honey', name: 'Honey', qty: 1, unit: 'tbsp', kcal: 64, carbs_g: 17 },
                    ],
                  },
                ],
              },
            ],
            shopping_list: [],
          },
        });
      }
      if (path === '/nutrition/meals/preview') {
        return json({
          meal: 'breakfast',
          raw_text: body.text,
          items: [
            itemOf('f-eggs', 2),
            itemOf('f-toast'),
            { name: 'Medium coffee, 2 cream', unit: 'cup', est: { kcal: 60, protein_g: 1, carbs_g: 2, fat_g: 5 } },
          ],
        });
      }
      if (path.startsWith('/me/coach-face')) return json({ face_id: null });
      return orig(u, o);
    }) as typeof window.fetch;
    setReady(true);
    return () => {
      window.fetch = orig;
    };
  }, [state]);

  if (!ready) return null;
  return (
    <CoachFaceProvider>
      <div className="app" style={{ background: 'oklch(93% 0.02 85)' }}>
        <div style={{ padding: 16, fontSize: 13, color: 'oklch(45% 0.02 120)' }}>
          {open ? (
            'Preview — the trail sits behind the sheet.'
          ) : (
            <button type="button" onClick={() => setOpen(true)}>
              Open Log breakfast
            </button>
          )}
        </div>
        {open && (
          <CaptureSheet
            occurrenceId="occ-preview"
            known={{ title: 'Log breakfast', time_of_day: '08:00', date: new Date().toISOString().slice(0, 10) }}
            onClose={() => setOpen(false)}
            onLogged={() => undefined}
            onOpenFood={() => undefined}
            onCoach={(note) => console.log('[preview] coach note:', note)}
          />
        )}
      </div>
    </CoachFaceProvider>
  );
}
