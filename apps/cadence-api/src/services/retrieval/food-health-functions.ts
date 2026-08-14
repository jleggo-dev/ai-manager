/**
 * Retrieval functions for FOOD, JOURNAL and RECORDED HISTORY — the half of the semantic layer
 * with its own data sources (nutrition logs, journal entries, Apple Health digests + rows).
 *
 * Split out of registry.ts when that file reached its size cap: this group's imports are
 * disjoint from the dossier core's, so the seam is real rather than arbitrary. `registry.ts`
 * still composes the one `RETRIEVAL_FUNCTIONS` map every caller reads.
 */
import type { DietaryProfile, EatingWindow, Food, NutritionLog, NutritionSummary, Recipe } from '@cadence/shared';
import { EMPTY_DIETARY_PROFILE, sanitizeDietaryProfile } from '@cadence/shared';
import { getDietaryProfile, getUser } from '../../repos/users.ts';
import { listNutritionLogs } from '../../repos/nutrition.ts';
import { listRecipes, searchRecipes } from '../../repos/recipes.ts';
import { listForCoach } from '../../repos/journal-entries.ts';
import { latestHealthDigest } from '../../repos/health-digests.ts';
import { listWorkoutHistory, type WorkoutHistoryRow } from '../../repos/workout-history.ts';
import { renderHealthDigest } from '../health-context.ts';
import { summarizeNutrition, renderNutritionLine } from '../nutrition-summarize.ts';
import { searchFoodsWithUsda } from '../food-sources/usda-enrich.ts';
import { renderEatingWindow } from './eating-window-line.ts';
import { isoRange, type RetrievalFunction } from './types.ts';

/** What `get_dietary_profile` returns: what they can't eat, plus when they eat. */
interface DietaryPlusWindow {
  profile: DietaryProfile;
  eating_window: EatingWindow | null;
}

export const FOOD_HEALTH_FUNCTIONS: Record<string, RetrievalFunction> = {
  get_food_log: {
    name: 'get_food_log',
    description:
      'Recent meals (last 7 days) with the deterministic food-log summary (days logged, meals/day, common items, alcohol days). Use for "how has my eating been?" or any food/nutrition question.',
    domains: ['nutrition'],
    async run(userId) {
      const { from, to } = isoRange(7);
      const meals = await listNutritionLogs(userId, from, to);
      return { meals, summary: summarizeNutrition(meals, 7) };
    },
    render(r) {
      const { meals, summary } = r as { meals: NutritionLog[]; summary: NutritionSummary };
      if (!meals.length) return 'Food log: nothing logged in the last 7 days.';
      const recent = meals
        .slice(0, 10)
        .map(
          (m) => `- ${m.date} ${m.meal}: ${m.items.map((i) => i.name).join(', ') || (m.raw_text ?? '').slice(0, 60)}`,
        )
        .join('\n');
      return [renderNutritionLine(summary), recent].filter(Boolean).join('\n');
    },
    rows(r) {
      return (r as { meals: unknown[] }).meals.length;
    },
  },

  /**
   * Req 5 Phase 3 — deterministic food lookup (local cache + USDA enrich).
   * Read-only; no LLM job wrapping HTTP. OFF barcodes stay on the browser path.
   */
  lookup_food: {
    name: 'lookup_food',
    description:
      "Look up foods by name in the user's cache + shared DB (incl. USDA whole foods on cache miss). Use when they ask what something is / macros / micros, or before suggesting a food. Params: { q: string, limit?: number }. Not for barcodes (Food tab handles OFF).",
    domains: ['nutrition', 'foods'],
    async run(userId, params) {
      const q = typeof params?.q === 'string' ? params.q.trim() : '';
      if (!q) return { q: '', foods: [] as Food[] };
      const limit = Math.min(10, Math.max(1, Number(params?.limit ?? 5) || 5));
      const foods = await searchFoodsWithUsda(userId, q, limit);
      return { q, foods };
    },
    render(r) {
      const { q, foods } = r as { q: string; foods: Food[] };
      if (!q) return 'Food lookup: pass q (food name).';
      if (!foods.length) return `Food lookup "${q}": no matches in cache/USDA yet.`;
      const lines = foods.slice(0, 8).map((f) => {
        const m = f.macros_per_base ?? {};
        const brand = f.brand ? ` (${f.brand})` : '';
        const macros = [
          typeof m.kcal === 'number' ? `${Math.round(m.kcal)} kcal` : null,
          typeof m.protein_g === 'number' ? `P${Math.round(m.protein_g)}` : null,
          typeof m.zinc_mg === 'number' ? `Zn ${m.zinc_mg}mg` : null,
          typeof m.iron_mg === 'number' ? `Fe ${m.iron_mg}mg` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        const per = f.base_unit === 'item' ? '/item' : '/100' + f.base_unit;
        return `- ${f.name}${brand} [${f.source}] ${macros}${macros ? ` ${per}` : ''}`;
      });
      return `Food lookup "${q}" (${foods.length}):\n${lines.join('\n')}`;
    },
    rows(r) {
      return (r as { foods: unknown[] }).foods.length;
    },
  },

  /**
   * The journal, as the coach may read it (REQ9 §4.5). This is the ONLY path journal words take
   * into a context pack, and it goes through `listForCoach` — which excludes secret entries and
   * paper rows in SQL. That is the whole privacy promise made mechanical: there is no argument to
   * this function that could widen it, and turning the key removes an entry from the very next
   * pack build.
   *
   * Words, verbatim, newest first — never themes, never sentiment, never a count. What the coach
   * does with them is remember ("three weeks ago you wrote…"), which is the entire point of the
   * store; a compression layer over these (REQ9 §12's parse_mind_log) only earns its place once
   * volume makes raw entries too big for a pack, exactly like REQ7's rollups.
   */
  get_journal: {
    name: 'get_journal',
    description:
      'Recent journal entries the user has written, in their own words (secret entries are never included). Use when they refer to something they wrote, when a pattern across entries would help, or to remember what mattered to them lately.',
    domains: ['journal', 'mind'],
    async run(userId, params) {
      const limit = typeof params?.limit === 'number' ? Math.min(20, Math.max(1, params.limit)) : 8;
      return listForCoach(userId, limit);
    },
    render(r) {
      const entries = r as Array<{ created_at: string; prompt: string | null; body: string }>;
      if (!entries.length) return '';
      const lines = entries.map((e) => {
        const date = e.created_at.slice(0, 10);
        const q = e.prompt ? ` (asked: ${e.prompt})` : '';
        return `  - ${date}${q}: ${e.body.replace(/\s+/g, ' ').slice(0, 300)}`;
      });
      return `Journal — their own words, most recent first:\n${lines.join('\n')}`;
    },
    rows(r) {
      return (r as unknown[]).length;
    },
  },

  /**
   * WHAT they eat and WHEN — two facts from two different columns, deliberately in one place.
   *
   * `dietary_profile` is a safety input (hard allergen excludes). `baseline.eating_window` is how
   * someone has chosen to eat, and it belongs nowhere near the allergen list as STORAGE — but this
   * is the moment both matter, "before suggesting foods/recipes", and minting a fifteenth retrieval
   * function for one line would mean a catalog change and a selection the model has to remember to
   * make. Storage stays apart; the render joins them.
   */
  get_dietary_profile: {
    name: 'get_dietary_profile',
    description:
      'Allergies (hard excludes), diet pattern (vegan/vegetarian/…), soft dislikes, and the hours they eat in (16:8, OMAD, Ramadan) when they have said. Use before suggesting foods/recipes and when the user mentions allergies, diet, or meal timing.',
    domains: ['nutrition', 'safety'],
    async run(userId) {
      const [raw, user] = await Promise.all([getDietaryProfile(userId), getUser(userId)]);
      return {
        profile: sanitizeDietaryProfile(raw) ?? { ...EMPTY_DIETARY_PROFILE },
        eating_window: user?.baseline?.eating_window ?? null,
      };
    },
    render(r) {
      const { profile: p, eating_window: w } = r as DietaryPlusWindow;
      const bits: string[] = [];
      if (p.allergies.length) bits.push(`allergies (hard): ${p.allergies.join(', ')}`);
      if (p.diet) bits.push(`diet: ${p.diet}`);
      if (p.dislikes.length) bits.push(`dislikes: ${p.dislikes.join(', ')}`);
      if (p.notes?.trim()) bits.push(`notes: ${p.notes.trim()}`);
      const head = bits.length
        ? `Dietary profile: ${bits.join('; ')}`
        : 'Dietary profile: none set yet (ask before first recipe if relevant).';
      const window = renderEatingWindow(w);
      return window ? `${head}\n${window}` : head;
    },
    rows(r) {
      const { profile: p, eating_window: w } = r as DietaryPlusWindow;
      return (
        p.allergies.length + p.dislikes.length + (p.diet ? 1 : 0) + (p.notes?.trim() ? 1 : 0) + (w?.said_as ? 1 : 0)
      );
    },
  },

  get_health_history: {
    name: 'get_health_history',
    description:
      'Recent activity the user shared from Apple Health — workouts by type with weekly frequency. Use during onboarding instead of asking them to type their workout history, and whenever what they actually did recently matters.',
    domains: ['movement', 'history'],
    async run(userId) {
      return latestHealthDigest(userId);
    },
    render(r) {
      const row = r as Awaited<ReturnType<typeof latestHealthDigest>>;
      if (!row) return '';
      return renderHealthDigest(row.digest, row.createdAt);
    },
    rows(r) {
      const row = r as Awaited<ReturnType<typeof latestHealthDigest>>;
      return row ? row.digest.totalWorkouts : 0;
    },
  },

  get_workout_history: {
    name: 'get_workout_history',
    description:
      "Individual recorded workouts from the user's devices (Apple Health), newest first — date, type, duration, distance. The session-by-session log behind get_health_history's summary. Use when WHICH days or sessions matters: what they did this morning, this week's actual runs, the gap since the last one. Params: { days }.",
    domains: ['movement', 'history'],
    async run(userId, params) {
      const days = Math.min(90, Math.max(1, Number(params?.days ?? 30)));
      return { days, workouts: await listWorkoutHistory(userId, days, 40) };
    },
    render(r) {
      const { days, workouts } = r as { days: number; workouts: WorkoutHistoryRow[] };
      if (!workouts.length) return '';
      const lines = workouts.map((w) => {
        const bits = [w.type];
        if (w.durationMin != null) bits.push(`${Math.round(w.durationMin)} min`);
        if (w.distanceKm != null) bits.push(`${w.distanceKm} km`);
        if (w.avgHr != null) bits.push(`avg ${Math.round(w.avgHr)} bpm`);
        return `- ${w.startedAt.slice(0, 10)} · ${bits.join(' · ')}`;
      });
      return `Recorded workouts (last ${days}d, newest first):\n${lines.join('\n')}`;
    },
    rows(r) {
      return (r as { workouts: WorkoutHistoryRow[] }).workouts.length;
    },
  },

  get_recipes: {
    name: 'get_recipes',
    description:
      "The user's own recipe book — dishes they saved or you cooked up with them before, with servings and per-serving macros. Use when they ask what they can make, refer to a dish they have saved (\"that chilli\"), or you are about to suggest food and something already in their book would do. Params: { query } to search by name.",
    domains: ['nutrition', 'recipes'],
    async run(userId, params) {
      const q = String(params?.query ?? '').trim();
      return q ? searchRecipes(userId, q, 10) : listRecipes(userId, { savedOnly: true, limit: 15 });
    },
    render(r) {
      const rows = r as Recipe[];
      if (!rows.length) return '';
      const lines = rows.map((x) => {
        const kcal = Math.round(x.macros_per_serving?.kcal ?? 0);
        const tags = x.tags?.length ? ` [${x.tags.slice(0, 3).join(', ')}]` : '';
        return `- ${x.name} (${x.servings} serving${x.servings === 1 ? '' : 's'}${kcal ? `, ~${kcal} kcal each` : ''})${tags}`;
      });
      return `Their recipe book:\n${lines.join('\n')}`;
    },
    rows(r) {
      return (r as Recipe[]).length;
    },
  },
};
