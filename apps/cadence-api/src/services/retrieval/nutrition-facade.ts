import { FOOD_HEALTH_FUNCTIONS } from './food-health-functions.ts';
import type { RetrievalFunction } from './types.ts';

/**
 * Four nutrition reads behind one door.
 *
 * `get_food_log`, `get_macro_targets`, `get_recipes` and `lookup_food` were four separate choices
 * she had to make correctly before she could answer anything about eating — and two of the audit's
 * eight hand-maintained tiebreak pairs existed purely to help her make them ("what they ate vs what
 * they could make", "their dishes vs facts about one food"). A tiebreak is a symptom: it documents
 * an ambiguity instead of removing it.
 *
 * Anthropic's test is the one that decided this: *"If a human engineer can't definitively say which
 * tool should be used in a given situation, an AI agent can't be expected to do better."* Their
 * prescribed fix is consolidation rather than more disambiguating prose, and GitHub ships exactly
 * this shape — one `issue_read` with a `method` enum and the menu in the PARAMETER description,
 * rather than five tools.
 *
 * So the choice becomes two easy ones instead of one hard one: is this about food (yes), and which
 * view (named in the parameter, where a menu belongs).
 *
 * The four originals stay implemented and keep their descriptions — this dispatches to them, and
 * `find_tools` never lists them. Nothing about what she can read changes; only how many decisions
 * stand between her and reading it.
 *
 * Dispatches through FOOD_HEALTH_FUNCTIONS, not RETRIEVAL_FUNCTIONS, and that is not a style
 * choice: the registry imports THIS module, so reaching back for the registry is a cycle. It cost
 * a production outage on 2026-08-16 — `registry.ts` evaluated `GET_NUTRITION.name` while this file
 * was still initializing, `GET_NUTRITION` was undefined, and the whole API failed to boot with
 * FUNCTION_INVOCATION_FAILED. Every test passed, because vitest happened to resolve the graph in
 * the lucky order. The four views all live in FOOD_HEALTH_FUNCTIONS, which imports nothing from
 * here, so this direction has no cycle to fall into.
 */

const VIEWS = {
  log: 'get_food_log',
  targets: 'get_macro_targets',
  recipes: 'get_recipes',
  lookup: 'lookup_food',
} as const;

export type NutritionView = keyof typeof VIEWS;

/** The originals, hidden from the tail because this facade covers them. */
export const NUTRITION_FACADE_COVERS = Object.values(VIEWS) as readonly string[];

const isView = (v: unknown): v is NutritionView => typeof v === 'string' && v in VIEWS;

export const GET_NUTRITION: RetrievalFunction = {
  name: 'get_nutrition',
  description:
    'Everything about what this user eats, in one place. Use for any food question, and say which view you need: "log" is what they actually ate, "targets" is their daily calorie and macro goals with how today is tracking, "recipes" is the dishes they have saved, and "lookup" is nutrition facts for one named food from a public database (that one needs "q"). Use for food; for how training went use get_recent_logs. Pass {"view": "log"} or {"view": "lookup", "q": "halloumi"}.',
  domains: ['nutrition', 'foods', 'recipes', 'progress'],
  async run(userId, params) {
    const view = isView(params?.view) ? params.view : 'log';
    const target = FOOD_HEALTH_FUNCTIONS[VIEWS[view]];
    if (!target) return { view, inner: null };
    return { view, inner: await target.run(userId, params ?? {}) };
  },
  render(r) {
    const { view, inner } = r as { view: NutritionView; inner: unknown };
    const target = FOOD_HEALTH_FUNCTIONS[VIEWS[view]];
    if (!target || inner === null) return '';
    return target.render(inner);
  },
  rows(r) {
    const { view, inner } = r as { view: NutritionView; inner: unknown };
    const target = FOOD_HEALTH_FUNCTIONS[VIEWS[view]];
    if (!target || inner === null) return 0;
    return target.rows(inner);
  },
};
