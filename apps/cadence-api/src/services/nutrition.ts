/**
 * Nutrition module — the OBSERVE phase (module arc, PLAN.md): week one is silent observation.
 * The user says what they ate (text/voice); parse-meal structures it; we record and NEVER judge,
 * estimate, or coach in this path. The coach sees the deterministic summary (dossier/retrieval/
 * replan) and introduces changes gradually — one at a time — only once ~7 days are logged.
 *
 * Shape cloned from services/session.ts: runJobBySlug + best-effort parse + app-side validation;
 * a parse failure NEVER loses the user's words (raw row still inserted, items empty).
 */
import { runJobBySlug } from '../ai/aim.ts';
import { insertNutritionLog, listNutritionLogs } from '../repos/nutrition.ts';
import { findPendingFoodLogOccurrence, setOccurrenceStatus } from '../repos/occurrences.ts';
import { summarizeNutrition } from './nutrition-summarize.ts';
import { logAi } from './ai-log.ts';
import type { MealKind, NutritionLog, NutritionSummary } from '@cadence/shared';

const MEALS: MealKind[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other'];
const isMeal = (v: unknown): v is MealKind => MEALS.includes(v as MealKind);

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * Record one meal from the user's words. Parse is best-effort — on any failure the raw text is
 * still stored (meal = hint or 'other', items empty) so nothing they said is lost. Side effect:
 * the first meal of the day ticks today's pending "Food log" system occurrence done (the
 * deterministic title test, mirroring the weigh-in pattern).
 */
export async function logMeal(
  userId: string,
  input: { text: string; meal?: MealKind; date?: string },
): Promise<NutritionLog> {
  const text = (input.text ?? '').trim().slice(0, 500);
  if (!text) throw new Error('empty meal text');
  const date = input.date ?? today();

  let meal: MealKind = input.meal && isMeal(input.meal) ? input.meal : 'other';
  let items: NutritionLog['items'] = [];
  let flags: NutritionLog['flags'] = {};
  let confidence: number | null = null;
  let rawOut = '';
  try {
    const res = await runJobBySlug(userId, 'parse-meal', { meal_text: text, meal_hint: input.meal ?? '' });
    rawOut = res.formatted ?? res.raw ?? '';
    const parsed = JSON.parse(rawOut) as Record<string, unknown>;
    if (!input.meal && isMeal(parsed.meal)) meal = parsed.meal; // an explicit user choice outranks the model
    if (Array.isArray(parsed.items)) {
      items = (parsed.items as Array<Record<string, unknown>>)
        .filter((i) => i && typeof i.name === 'string' && (i.name as string).trim())
        .slice(0, 12)
        .map((i) => ({
          name: (i.name as string).trim(),
          ...(typeof i.qty === 'number' && i.qty > 0 ? { qty: i.qty } : {}),
          ...(typeof i.unit === 'string' && (i.unit as string).trim() ? { unit: (i.unit as string).trim() } : {}),
        }));
    }
    const f = parsed.flags as Record<string, unknown> | undefined;
    flags = { ...(f?.alcohol === true ? { alcohol: true } : {}), ...(f?.caffeine === true ? { caffeine: true } : {}) };
    if (typeof parsed.confidence === 'number') confidence = Math.max(0, Math.min(1, parsed.confidence));
  } catch (e) {
    console.warn('[nutrition] parse-meal failed — storing raw text only:', e);
  }

  const row = await insertNutritionLog(userId, {
    date,
    meal,
    items,
    input_method: 'text',
    ai_confidence: confidence,
    raw_text: text,
    flags,
  });

  // Best-effort: tick today's pending Food log row (never fails the meal write).
  try {
    const occId = await findPendingFoodLogOccurrence(userId, date);
    if (occId) await setOccurrenceStatus(userId, occId, 'done');
  } catch (e) {
    console.warn('[nutrition] food-log occurrence tick failed:', e);
  }

  void logAi(userId, {
    kind: 'parse_meal',
    input: { text, meal_hint: input.meal ?? null },
    output: { raw: rawOut.slice(0, 2000) },
    meta: { meal, items: items.length, flags, confidence },
  });
  return row;
}

/** Deterministic Observe-phase summary over the last N days (the coach's food-log read). */
export async function getNutritionSummary(userId: string, days = 7): Promise<NutritionSummary> {
  const to = today();
  const from = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return summarizeNutrition(await listNutritionLogs(userId, from, to), days);
}

/** Recent meals, newest first (the UI list + retrieval detail). */
export async function listRecentMeals(userId: string, days = 7): Promise<NutritionLog[]> {
  const to = today();
  const from = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return listNutritionLogs(userId, from, to);
}
