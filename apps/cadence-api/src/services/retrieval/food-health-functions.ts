/**
 * Retrieval functions for FOOD, JOURNAL and RECORDED HISTORY — the half of the semantic layer
 * with its own data sources (nutrition logs, journal entries, Apple Health digests + rows).
 *
 * Split out of registry.ts when that file reached its size cap: this group's imports are
 * disjoint from the dossier core's, so the seam is real rather than arbitrary. `registry.ts`
 * still composes the one `RETRIEVAL_FUNCTIONS` map every caller reads.
 */
import type { DietaryProfile, EatingWindow, Food, NutritionLog, NutritionSummary, Recipe } from '@cadence/shared';
import {
  EMPTY_DIETARY_PROFILE,
  sanitizeDietaryProfile,
  formatWeightRate,
  type WeightUnit,
  resolveUnit,
} from '@cadence/shared';
import { getDietaryProfile, getUser } from '../../repos/users.ts';
import { listWeighInSeries } from '../../repos/occurrences.ts';
import { getNutritionDay } from '../nutrition.ts';
import { actualWeeklyRate, classifyLossPace, safeWeeklyKg } from '../weight-trend.ts';
import { listNutritionLogs } from '../../repos/nutrition.ts';
import { sumWaterMl } from '../../repos/water.ts';
import { listRecipes, searchRecipes } from '../../repos/recipes.ts';
import { listForCoach } from '../../repos/journal-entries.ts';
import { latestHealthDigest } from '../../repos/health-digests.ts';
import { isoDay } from '../iso-day.ts';
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
      'What the user has actually eaten over the last 7 days — each logged meal, plus a short summary (days logged, meals per day, items that come up often, days with alcohol); lists the 10 most recent meals. Use for "how has my eating been?" or any question about their recent diet. For dishes they could MAKE, use get_recipes.',
    domains: ['nutrition'],
    async run(userId) {
      const { from, to } = isoRange(7);
      const [meals, waterMl] = await Promise.all([
        listNutritionLogs(userId, from, to),
        sumWaterMl(userId, to), // today's water rides along — the log's write half has no other read
      ]);
      return { meals, summary: summarizeNutrition(meals, 7), water_ml_today: waterMl };
    },
    render(r) {
      const { meals, summary, water_ml_today } = r as {
        meals: NutritionLog[];
        summary: NutritionSummary;
        water_ml_today?: number;
      };
      const water = water_ml_today ? `Water today: ${(water_ml_today / 1000).toFixed(1)} L.` : '';
      if (!meals.length) return ['Food log: nothing logged in the last 7 days.', water].filter(Boolean).join(' ');
      const recent = meals
        .slice(0, 10)
        .map(
          (m) => `- ${m.date} ${m.meal}: ${m.items.map((i) => i.name).join(', ') || (m.raw_text ?? '').slice(0, 60)}`,
        )
        .join('\n');
      return [renderNutritionLine(summary), water, recent].filter(Boolean).join('\n');
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
      'Nutrition facts for a food, looked up by name — calories, protein and key nutrients per standard amount, from the user\'s saved foods plus a public food database. Use when they ask what is in a food, or before recommending one. Not for barcode scans — the app\'s Food tab handles those. Pass {"q": "lentils"}; add {"limit": 8} for more matches (default 5, up to 10).',
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
      'Recent journal entries the user has written, in their own words (entries they marked private are never included). Use when they refer to something they wrote, when a pattern across entries would help, or to remember what has mattered to them lately. Pass {"limit": 15} for more entries (default 8, up to 20).',
    domains: ['journal', 'mind'],
    async run(userId, params) {
      const limit = typeof params?.limit === 'number' ? Math.min(20, Math.max(1, params.limit)) : 8;
      return listForCoach(userId, limit);
    },
    render(r) {
      // created_at is typed string and arrives as a Date (see iso-day.ts) — isoDay takes either.
      const entries = r as Array<{ created_at: string | Date; prompt: string | null; body: string }>;
      if (!entries.length) return '';
      const lines = entries.map((e) => {
        const date = isoDay(e.created_at);
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
      'What the user can and will eat: allergies (never suggest these), diet pattern (vegan, vegetarian, …), foods they dislike, and the hours of the day they eat in (16:8, OMAD, Ramadan) when they have said. Use before suggesting any food, meal or recipe, and whenever they mention allergies, diet, or meal timing.',
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
      'A summary of the user\'s recorded exercise from Apple Health — workout types, each with how often per week it happens. Use for the overall picture of what they actually do ("runs about twice a week"), and during onboarding instead of asking them to type their history. For individual sessions on specific days, use get_workout_history.',
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
      "Individual recorded workouts from the user's devices (Apple Health), newest first — date, type, duration, distance. Use when specific days or sessions matter: what they did this morning, this week's actual runs, the gap since the last one. This is the session-by-session detail behind get_health_history's summary; for how a session FELT, use get_recent_logs (their own reports). Pass {\"days\": 7} to set the period (default 30, up to 90).",
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
        return `- ${isoDay(w.startedAt)} · ${bits.join(' · ')}`;
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
      'The user\'s own recipe book — dishes they saved or you cooked up with them before, with servings and per-serving calories. Use when they ask what they can make, refer to a saved dish ("that chilli"), or before inventing a new recipe when something in their book would do. For nutrition facts on a single ingredient, use lookup_food. Pass {"query": "chilli"} to search by name; with no query it returns their saved dishes (up to 15).',
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

  get_macro_targets: {
    name: 'get_macro_targets',
    description:
      "The user's daily nutrition targets, how today is tracking against them, and — when they weigh in — whether the scale says those targets are working. Use before any conversation about what they should be eating, before proposing a change to their targets, and whenever they ask how they are doing on food. If they have no targets yet, this says so, which is your cue to work some out with them rather than guessing at portions.",
    domains: ['nutrition', 'progress'],
    async run(userId) {
      const [user, day, series] = await Promise.all([
        getUser(userId),
        getNutritionDay(userId),
        listWeighInSeries(userId),
      ]);
      const targets = user?.macro_targets ?? null;
      const currentKg = user?.baseline?.weight_kg?.current;
      const actual = actualWeeklyRate(series);
      const safe = typeof currentKg === 'number' ? safeWeeklyKg(currentKg) : null;
      return {
        targets: targets && Object.keys(targets).length ? targets : null,
        eaten: day.totals,
        left: day.left,
        // Carried so the render converts rather than instructing her to (see the trend block).
        unit: resolveUnit(user?.unit_prefs, 'body_weight', user?.baseline?.weight_unit) as WeightUnit,
        last_reviewed: targets?.last_reviewed ?? null,
        trend:
          actual != null && safe != null
            ? {
                actual_kg_per_week: Math.round(actual * 100) / 100,
                safe_kg_per_week: safe,
                pace: classifyLossPace(actual, safe),
              }
            : null,
      };
    },
    render(r) {
      const {
        targets,
        eaten,
        left,
        last_reviewed,
        trend,
        unit = 'kg',
      } = r as {
        targets: Record<string, number | string | null> | null;
        eaten: Record<string, number>;
        left: Record<string, number> | null;
        last_reviewed: string | null;
        trend: { actual_kg_per_week: number; safe_kg_per_week: number; pace: string } | null;
        unit?: WeightUnit;
      };
      const lines: string[] = [];
      if (!targets) {
        lines.push('Daily targets: none set yet — nothing to eat toward, so any portion advice is a guess.');
      } else {
        const t = ['kcal', 'protein_g', 'carbs_g', 'fat_g']
          .filter((k) => typeof targets[k] === 'number')
          .map((k) => `${k.replace('_g', '')} ${String(targets[k])}`)
          .join(', ');
        lines.push(
          `Daily targets: ${t || 'set, but empty'}${last_reviewed ? ` (last reviewed ${last_reviewed})` : ''}`,
        );
        if (left && Object.keys(left).length) {
          lines.push(
            `Left today: ${Object.entries(left)
              .map(([k, v]) => `${k.replace('_g', '')} ${Math.round(v)}`)
              .join(', ')}`,
          );
        }
      }
      if (eaten?.kcal != null) lines.push(`Eaten today: ${Math.round(eaten.kcal)} kcal`);
      if (trend) {
        /**
         * In their unit, converted here.
         *
         * This is the read `set_macro_targets` tells her to take BEFORE adjusting — "get_macro_targets
         * reports the actual weekly weight change against a safe rate" — so a user who thinks in
         * pounds was being shown the evidence for their own targets in kilos. Same fix as
         * `get_weight`, same reasoning: hand over a number that is already right rather than a rule
         * for converting it.
         */
        const rate = (kgPerWeek: number) => formatWeightRate(kgPerWeek, unit);
        const verdict =
          trend.pace === 'too_fast'
            ? `losing ${rate(trend.actual_kg_per_week)}, FASTER than the safe ${rate(trend.safe_kg_per_week)} — the targets are too aggressive`
            : trend.pace === 'too_slow'
              ? `changing ${rate(trend.actual_kg_per_week)}, slower than expected — the targets may not be doing the work`
              : `${rate(trend.actual_kg_per_week)}, within the safe ${rate(trend.safe_kg_per_week)} — on track`;
        lines.push(`Weight trend: ${verdict}.`);
      }
      return lines.join('\n');
    },
    rows(r) {
      return (r as { targets: unknown }).targets ? 1 : 0;
    },
  },
};
