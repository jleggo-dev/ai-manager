/**
 * Pure nutrition helpers (no DB / AI Admin imports) — unit-testable without CADENCE_* secrets.
 * Used by services/nutrition.ts for parse-meal shaping and baseline target gating.
 */
import { sanitizeMacros } from './nutrition-day.ts';
import type { Macros, MealKind, NutritionLog } from '@cadence/shared';

/** Below this parse confidence, macro estimates are PROVISIONAL: shown, but excluded from the
 *  day's totals until the user taps to confirm (spec S1; tunable later via macro_targets). */
export const PROVISIONAL_BELOW = 0.5;

const MEALS: MealKind[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other'];
export const isMeal = (v: unknown): v is MealKind => MEALS.includes(v as MealKind);

/** Shaped parse-meal job output. */
export interface ParsedMealResult {
  meal: MealKind;
  items: NutritionLog['items'];
  flags: NutritionLog['flags'];
  confidence: number | null;
  macros: Macros | null;
}

/**
 * Shape a parse-meal JSON blob into the fields we persist. Throws on malformed JSON (callers
 * catch and fall back to raw text + empty items — never lose the user's words).
 * An explicit user meal choice outranks the model's `meal` field.
 */
export function parseMealResult(raw: string, explicitMeal?: MealKind): ParsedMealResult {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  let meal: MealKind = explicitMeal && isMeal(explicitMeal) ? explicitMeal : 'other';
  if (!explicitMeal && isMeal(parsed.meal)) meal = parsed.meal;

  let items: NutritionLog['items'] = [];
  if (Array.isArray(parsed.items)) {
    items = (parsed.items as Array<Record<string, unknown>>)
      .filter((i) => i && typeof i.name === 'string' && (i.name as string).trim())
      .slice(0, 12)
      .map((i) => {
        const est = sanitizeMacros(i.est);
        return {
          name: (i.name as string).trim(),
          ...(typeof i.qty === 'number' && i.qty > 0 ? { qty: i.qty } : {}),
          ...(typeof i.unit === 'string' && (i.unit as string).trim() ? { unit: (i.unit as string).trim() } : {}),
          ...(est ? { est } : {}),
        };
      });
  }

  const f = parsed.flags as Record<string, unknown> | undefined;
  const flags: NutritionLog['flags'] = {
    ...(f?.alcohol === true ? { alcohol: true } : {}),
    ...(f?.caffeine === true ? { caffeine: true } : {}),
  };

  let confidence: number | null = null;
  if (typeof parsed.confidence === 'number') confidence = Math.max(0, Math.min(1, parsed.confidence));

  const est = sanitizeMacros(parsed.est_macros);
  const macros: Macros | null = est ? { ...est, source: 'ai' } : null;

  return { meal, items, flags, confidence, macros };
}

/** Deterministic gate: targets are only WORTH proposing for an eating-focused or weight goal. */
const WEIGHTY_MEASURE = /\b(kg|lbs?|weight)\b/i;
export function wantsTargets(
  goals: Array<{ area?: string; type?: string; measure?: { unit?: string; metric?: string } }>,
): boolean {
  return goals.some(
    (g) =>
      g.area === 'nourishment' ||
      (g.type === 'target' &&
        (WEIGHTY_MEASURE.test(String(g.measure?.unit ?? '')) || WEIGHTY_MEASURE.test(String(g.measure?.metric ?? '')))),
  );
}
