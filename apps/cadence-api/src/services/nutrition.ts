/**
 * Nutrition module — the OBSERVE phase (module arc, PLAN.md): week one is silent observation.
 * The user says what they ate (text/voice); parse-meal structures it; we record and NEVER judge,
 * estimate, or coach in this path. The coach sees the deterministic summary (dossier/retrieval/
 * replan) and introduces changes gradually — one at a time — only once ~7 days are logged.
 *
 * Shape cloned from services/session.ts: runJobBySlug + best-effort parse + app-side validation;
 * a parse failure NEVER loses the user's words (raw row still inserted, items empty).
 */
import {
  type Macros,
  type MacroTargets,
  type MealKind,
  type NutritionLog,
  type NutritionSummary,
} from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import { insertNutritionLog, listNutritionLogs, updateNutritionLog } from '../repos/nutrition.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import { getUser, setMacroTargets } from '../repos/users.ts';
import {
  findPendingFoodLogOccurrence,
  findPendingMealOccurrence,
  setOccurrenceStatus,
  listDoneUserOccurrencesForDay,
  listWeighInSeries,
} from '../repos/occurrences.ts';
import { putMealPhoto, signMealPhotoUrl, signMealPhotoUrls } from './meal-photos.ts';
import { estimateBurnKcal } from './burn.ts';
import { actualWeeklyRate, safeWeeklyKg, classifyLossPace } from './weight-trend.ts';
import { summarizeNutrition } from './nutrition-summarize.ts';
import { sanitizeMacros, sanitizeTargets, sumDay, computeLeft, type DayTotals } from './nutrition-day.ts';
import { isMeal, parseMealResult, wantsTargets, PROVISIONAL_BELOW, type ParsedMealResult } from './nutrition-parse.ts';
import { logAi } from './ai-log.ts';
import { logMealFromFood, logMealFromItems, logMealFromRecipe } from './nutrition-log-saved.ts';
import type { PlateItemInput } from './plate-compose.ts';
import { getFoodsByIds } from '../repos/foods.ts';
import { buildNutritionInsight, type NutritionInsightPack } from './nutrition-insight.ts';
import { buildMicroInsightRollup } from './nutrition-insight-micro.ts';

export { parseMealResult, wantsTargets, PROVISIONAL_BELOW, isMeal } from './nutrition-parse.ts';
export type { ParsedMealResult } from './nutrition-parse.ts';
export { logMealFromFood, logMealFromRecipe } from './nutrition-log-saved.ts';
export type { NutritionInsightPack } from './nutrition-insight.ts';

const today = (): string => new Date().toISOString().slice(0, 10);

async function tickFoodLogOccurrence(userId: string, date: string, meal?: string): Promise<void> {
  try {
    // Prefer the specific meal task (the redesign's per-meal logs); fall back to the single "Food
    // log" row for plans that predate the split, and for drink/other which map to no meal task.
    const occId =
      (meal ? await findPendingMealOccurrence(userId, date, meal) : null) ??
      (await findPendingFoodLogOccurrence(userId, date));
    if (occId) await setOccurrenceStatus(userId, occId, 'done');
  } catch (e) {
    console.warn('[nutrition] meal-log occurrence tick failed:', e);
  }
}

/**
 * Record one meal from the user's words and/or a photo, or a saved food_id / recipe_id
 * (deterministic). Parse is best-effort — on any failure the raw text is still stored
 * (meal = hint or 'other', items empty) so nothing they said is lost. A photo uploads to
 * private Storage FIRST. Side effect: the first meal of the day ticks today's pending
 * "Food log" occurrence done.
 */
/**
 * Run the parse-meal job over the user's words and shape the result — persisting NOTHING.
 *
 * The read half of confirm-first food logging: the Food surfaces call this to show an itemized
 * preview (each ingredient with its quantity and estimate), and only the user's confirm writes a
 * row — via `logMeal({ parsed })`, which stores exactly what was previewed. Before this existed
 * the only itemizing path logged immediately, so the Food tab funnelled multi-ingredient meals
 * into the single-food resolver instead — and someone who typed five exact quantities was asked
 * to "select the serving size" (owner, 2026-08-15).
 */
export async function previewMealParse(
  userId: string,
  text: string,
  mealHint?: MealKind,
): Promise<ParsedMealResult & { raw_text: string }> {
  const trimmed = text.trim().slice(0, 500);
  if (!trimmed) throw new Error('a meal needs words');
  const res = await runJobBySlug(userId, 'parse-meal', {
    meal_text: trimmed,
    meal_hint: mealHint ?? '',
  });
  const rawOut = res.formatted ?? res.raw ?? '';
  const shaped = parseMealResult(rawOut, mealHint && isMeal(mealHint) ? mealHint : undefined);
  void logAi(userId, {
    kind: 'parse_meal',
    input: { text: trimmed, meal_hint: mealHint ?? null, preview: true },
    output: { raw: rawOut.slice(0, 2000) },
    meta: { meal: shaped.meal, items: shaped.items.length, confidence: shaped.confidence, preview: true },
  });
  return { ...shaped, raw_text: trimmed };
}

/** A previewed parse, confirmed by the user — logged verbatim, no second AI pass. */
export interface ParsedMealInput {
  meal: MealKind;
  items: NutritionLog['items'];
  macros: Macros | null;
  confidence: number | null;
  flags: NutritionLog['flags'];
  raw_text: string;
  date?: string;
}

export async function logMeal(
  userId: string,
  input: {
    text?: string;
    meal?: MealKind;
    date?: string;
    photo?: string;
    food_id?: string;
    recipe_id?: string;
    serving_index?: number;
    quantity?: number;
    items?: PlateItemInput[];
    parsed?: ParsedMealInput;
  },
): Promise<NutritionLog> {
  // Confirm of a previewed parse: deterministic insert of what the user saw. The card is the
  // truth and the tap is the consent — same contract as every confirm-first surface here.
  if (input.parsed) {
    const p = input.parsed;
    const date = p.date ?? input.date ?? today();
    // The wire shape is client-supplied, so every number passes the same sanitizer the AI path
    // uses — a confirm must not be a door around the caps.
    const macros = sanitizeMacros(p.macros);
    const items = p.items.map((i) => {
      const est = sanitizeMacros(i.est);
      return { ...i, ...(est ? { est } : { est: undefined }) };
    });
    const provisional = !!macros && p.confidence !== null && p.confidence < PROVISIONAL_BELOW;
    const row = await insertNutritionLog(userId, {
      date,
      meal: p.meal,
      items,
      input_method: 'text',
      ai_confidence: p.confidence,
      raw_text: p.raw_text || null,
      flags: p.flags,
      photo_ref: null,
      macros,
      provisional,
    });
    await tickFoodLogOccurrence(userId, date, p.meal);
    return row;
  }
  if (input.items?.length) {
    return logMealFromItems(userId, { items: input.items, meal: input.meal, date: input.date });
  }
  if (input.food_id) {
    return logMealFromFood(userId, {
      food_id: input.food_id,
      meal: input.meal,
      date: input.date,
      serving_index: input.serving_index,
      quantity: input.quantity,
    });
  }
  if (input.recipe_id) {
    return logMealFromRecipe(userId, {
      recipe_id: input.recipe_id,
      meal: input.meal,
      date: input.date,
      quantity: input.quantity,
    });
  }

  const text = (input.text ?? '').trim().slice(0, 500);
  const date = input.date ?? today();
  if (!text && !input.photo) throw new Error('a meal needs words or a photo');

  // Photo first — if the upload fails the user gets a clean error before any row exists.
  let photoRef: string | null = null;
  if (input.photo) photoRef = await putMealPhoto(userId, date, input.photo);

  let meal: MealKind = input.meal && isMeal(input.meal) ? input.meal : 'other';
  let items: NutritionLog['items'] = [];
  let flags: NutritionLog['flags'] = {};
  let macros: Macros | null = null;
  let confidence: number | null = null;
  let rawOut = '';
  try {
    // Vision path: the freshly-uploaded photo rides to the model as a short-lived signed URL
    // (N1 content parts). Words, plate, or both — same job, same audit trail.
    const images = photoRef ? [await signMealPhotoUrl(photoRef)] : [];
    const res = await runJobBySlug(
      userId,
      'parse-meal',
      { meal_text: text || '(no caption — read the photo)', meal_hint: input.meal ?? '' },
      { images },
    );
    rawOut = res.formatted ?? res.raw ?? '';
    const shaped = parseMealResult(rawOut, input.meal && isMeal(input.meal) ? input.meal : undefined);
    meal = shaped.meal;
    items = shaped.items;
    flags = shaped.flags;
    macros = shaped.macros;
    confidence = shaped.confidence;
  } catch (e) {
    console.warn('[nutrition] parse-meal failed — storing the meal without a parse:', e);
  }

  // Low-confidence estimates are provisional: listed, but excluded from totals until confirmed.
  const provisional = !!macros && confidence !== null && confidence < PROVISIONAL_BELOW;

  const row = await insertNutritionLog(userId, {
    date,
    meal,
    items,
    input_method: photoRef ? 'photo' : 'text',
    ai_confidence: confidence,
    raw_text: text || null,
    flags,
    photo_ref: photoRef,
    macros,
    provisional,
  });

  await tickFoodLogOccurrence(userId, date, meal);

  void logAi(userId, {
    kind: 'parse_meal',
    input: { text, meal_hint: input.meal ?? null },
    output: { raw: rawOut.slice(0, 2000) },
    meta: { meal, items: items.length, flags, confidence, photo: !!photoRef, macros: !!macros, provisional },
  });
  return row;
}

export interface NutritionDay extends DayTotals {
  date: string;
  meals: NutritionLog[]; // newest first, signed photo URLs attached
  targets: MacroTargets | null; // null until the coach proposes + the user confirms (N3)
  left: Macros | null; // per confirmed targets (incl. eat-back), clamped ≥0 — count what's left, never what broke
  burn_kcal: number; // estimated exercise burn from today's DONE workouts (net calories)
  eatback_kcal: number; // burn_kcal × eatback_pct, added to the kcal allowance (already reflected in `left`)
  eatback_pct: number; // the eat-back setting in effect (0–100; default 50)
}

/** One day's meals + deterministic totals (confirmed vs provisional) + targets/left when set. `left`
 *  reflects NET calories: base kcal target + the eaten-back share of today's estimated exercise burn. */
export async function getNutritionDay(userId: string, date?: string): Promise<NutritionDay> {
  const d = date ?? today();
  const [rows, user, done] = await Promise.all([
    listNutritionLogs(userId, d, d),
    getUser(userId),
    listDoneUserOccurrencesForDay(userId, d),
  ]);
  let meals = rows;
  try {
    meals = await signMealPhotoUrls(rows);
  } catch (e) {
    console.warn('[nutrition] day photo signing failed — returning rows without photos:', e);
  }
  const sums = sumDay(rows);
  const targets = user?.macro_targets ?? null;

  // Net calories: estimate today's exercise burn, add eatback_pct% of it to the kcal allowance.
  //
  // `o.duration_min` is the scheduled EFFORT, not the whole session (owner ruling 2026-08-17), and
  // that is the RIGHT input here — deliberately, not by accident. The MET constants in burn.ts
  // (run 9.8, strength 5.0) describe the intensity of the work itself, so the old whole-session
  // number was charging a five-minute warm-up walk at running rate and over-estimating the burn.
  // Do not "restore" the lost minutes by padding this: that re-introduces the over-count. If the
  // warm-up should ever be counted, it belongs in a lower-MET term of its own.
  const weightKg = user?.baseline?.weight_kg?.current;
  const burn_kcal = done.reduce((s, o) => s + estimateBurnKcal(o.category, o.duration_min, weightKg), 0);
  const eatback_pct = typeof targets?.eatback_pct === 'number' ? targets.eatback_pct : 50;
  const eatback_kcal = Math.round((burn_kcal * eatback_pct) / 100 / 10) * 10;
  const effective =
    targets && typeof targets.kcal === 'number' ? { ...targets, kcal: targets.kcal + eatback_kcal } : targets;

  return {
    date: d,
    meals,
    ...sums,
    targets,
    left: computeLeft(effective, sums.totals),
    burn_kcal,
    eatback_kcal,
    eatback_pct,
  };
}

/**
 * Tap-to-correct/confirm (spec S3): the user's word always wins. A bare confirm keeps the AI's
 * numbers but graduates them into the totals; any provided macros are sanitized and marked
 * source 'user' with full confidence.
 */
export async function patchMeal(
  userId: string,
  logId: string,
  patch: { meal?: MealKind; items?: NutritionLog['items']; macros?: unknown; confirm?: boolean },
): Promise<NutritionLog | null> {
  const update: Parameters<typeof updateNutritionLog>[2] = {};
  if (patch.meal && isMeal(patch.meal)) update.meal = patch.meal;
  if (Array.isArray(patch.items)) {
    update.items = patch.items
      .filter((i) => i && typeof i.name === 'string' && i.name.trim())
      .slice(0, 12)
      .map((i) => ({ ...i, name: i.name.trim() }));
  }
  if (patch.macros !== undefined) {
    const m = sanitizeMacros(patch.macros);
    if (m) update.macros = { ...m, source: 'user' };
  }
  if (patch.confirm || update.macros) {
    update.provisional = false;
    update.ai_confidence = 1;
  }
  if (Object.keys(update).length === 0) return null;
  return updateNutritionLog(userId, logId, update);
}

/** Deterministic Observe-phase summary over the last N days (the coach's food-log read). */
export async function getNutritionSummary(userId: string, days = 7): Promise<NutritionSummary> {
  const to = today();
  const from = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return summarizeNutrition(await listNutritionLogs(userId, from, to), days);
}

/**
 * Req 5 WS-I — coach-voiced insight pack for the nutrition card.
 * Reuses `getNutritionDay` totals/left (no forked day math) + one unsigned recent-log fetch
 * for Observe summary / pattern / variety (no photo URL signing).
 */
export async function getNutritionInsight(userId: string, date?: string): Promise<NutritionInsightPack> {
  const windowDays = 7;
  const to = today();
  const from = new Date(Date.now() - (windowDays - 1) * 86_400_000).toISOString().slice(0, 10);
  const [day, recent] = await Promise.all([getNutritionDay(userId, date), listNutritionLogs(userId, from, to)]);
  const summary = summarizeNutrition(recent, windowDays);
  // MacroTargets allows null fields; insight builder only needs positive macro numbers.
  const targets: Macros | null = day.targets
    ? {
        ...(typeof day.targets.kcal === 'number' ? { kcal: day.targets.kcal } : {}),
        ...(typeof day.targets.protein_g === 'number' ? { protein_g: day.targets.protein_g } : {}),
        ...(typeof day.targets.carbs_g === 'number' ? { carbs_g: day.targets.carbs_g } : {}),
        ...(typeof day.targets.fat_g === 'number' ? { fat_g: day.targets.fat_g } : {}),
      }
    : null;
  const targetsOrNull = targets && Object.keys(targets).length ? targets : null;

  // Micro rollup: load linked foods once; gate inside buildMicroInsightRollup / microInsights.
  const foodIds = recent.flatMap((m) =>
    (m.provisional ? [] : (m.items ?? [])).map((i) => (typeof i.food_id === 'string' ? i.food_id : '')).filter(Boolean),
  );
  let microRollup = null;
  try {
    const foods = await getFoodsByIds(userId, foodIds);
    const foodsById = new Map(foods.map((f) => [f.food_id, f]));
    microRollup = buildMicroInsightRollup(recent, foodsById, summary.days_logged);
  } catch (err) {
    console.warn('[nutrition] micro rollup skipped:', err instanceof Error ? err.message : err);
  }

  return buildNutritionInsight(
    {
      date: day.date,
      meals: day.meals,
      totals: day.totals,
      provisional_totals: day.provisional_totals,
      targets: targetsOrNull,
      left: day.left,
      confirmed_count: day.confirmed_count,
      provisional_count: day.provisional_count,
    },
    summary,
    recent,
    microRollup,
  );
}

/** Recent meals, newest first, with short-lived signed photo URLs attached (UI list). */
export async function listRecentMeals(userId: string, days = 7): Promise<NutritionLog[]> {
  const to = today();
  const from = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const rows = await listNutritionLogs(userId, from, to);
  try {
    return await signMealPhotoUrls(rows);
  } catch (e) {
    console.warn('[nutrition] photo URL signing failed — returning rows without photos:', e);
    return rows;
  }
}

export type BaselineRead =
  | { ready: false; days_logged: number; days_needed: number }
  | {
      ready: true;
      read: string;
      suggestion: string;
      rationale: string;
      /** Coach-proposed daily targets (S4) — suggest-never-auto-apply; null when not warranted
       *  (no eating/weight goal), already set (Settings owns edits), or the model declined. */
      proposed_targets: Macros | null;
      targets_rationale: string | null;
    };

const OBSERVE_DAYS_NEEDED = 7;

/**
 * The Baseline moment (module arc): after ~7 OBSERVED days, the coach gives their pattern read
 * and proposes exactly ONE gradual change. The gate is deterministic (distinct logged days);
 * the read is grounded in the actual log; the change is suggest-never-auto-apply — the caller
 * hands `suggestion` to the replan steer, and the existing preview→confirm flow owns the commit.
 */
export async function getBaselineRead(userId: string): Promise<BaselineRead> {
  const to = today();
  const from = new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10); // 14d window: a slow logger still crosses the gate
  const meals = await listNutritionLogs(userId, from, to);
  const summary = summarizeNutrition(meals, 14);
  if (summary.days_logged < OBSERVE_DAYS_NEEDED) {
    return { ready: false, days_logged: summary.days_logged, days_needed: OBSERVE_DAYS_NEEDED };
  }

  const [goals, user, weighSeries] = await Promise.all([
    listGoalsByStatus(userId, ['confirmed', 'committed']),
    getUser(userId),
    listWeighInSeries(userId),
  ]);
  const hasTargets = !!user?.macro_targets && Object.keys(user.macro_targets).length > 0;

  // Two proposal modes. INITIAL (Baseline moment): propose targets only when a goal warrants them and
  // none are set. ADAPTIVE (recurring): once targets ARE set and the weigh-in trend is trustworthy,
  // propose an ADJUSTED target from the trend vs. a safe rate — throttled to ~weekly via last_reviewed.
  const actualRate = actualWeeklyRate(weighSeries);
  const currentKg = user?.baseline?.weight_kg?.current;
  const lastReviewed = user?.macro_targets?.last_reviewed;
  const dueForReview = !lastReviewed || Date.now() - Date.parse(lastReviewed) >= 7 * 86_400_000;
  const proposeAdaptive = hasTargets && actualRate != null && typeof currentKg === 'number' && dueForReview;
  const propose = proposeAdaptive || (!hasTargets && wantsTargets(goals));

  const safeKg = typeof currentKg === 'number' ? safeWeeklyKg(currentKg) : null;
  const weightTrend =
    proposeAdaptive && actualRate != null && safeKg != null
      ? {
          actual_kg_per_week: Math.round(actualRate * 100) / 100,
          safe_kg_per_week: safeKg,
          pace: classifyLossPace(actualRate, safeKg),
        }
      : null;

  const res = await runJobBySlug(userId, 'nutrition-baseline', {
    summary: JSON.stringify(summary),
    meals: JSON.stringify(
      meals.map((m) => ({ date: m.date, meal: m.meal, items: m.items.map((i) => i.name), flags: m.flags })),
    ),
    goals: JSON.stringify(goals.map((g) => ({ title: g.title, area: g.area, type: g.type, measure: g.measure }))),
    baseline: JSON.stringify(user?.baseline ?? {}),
    propose_targets: propose ? 'yes' : 'no',
    weight_trend: weightTrend ? JSON.stringify(weightTrend) : '',
    current_targets: proposeAdaptive ? JSON.stringify(user?.macro_targets ?? {}) : '',
  });
  const raw = res.formatted ?? res.raw ?? '';
  const parsed = JSON.parse(raw) as {
    read?: unknown;
    suggestion?: unknown;
    rationale?: unknown;
    proposed_targets?: unknown;
    targets_rationale?: unknown;
  };
  const read = typeof parsed.read === 'string' ? parsed.read.trim() : '';
  const suggestion = typeof parsed.suggestion === 'string' ? parsed.suggestion.trim().slice(0, 300) : '';
  const rationale = typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '';
  if (!read || !suggestion) throw new Error('nutrition-baseline returned an incomplete read');
  // The deterministic gate is the wall — a proposal the app didn't ask for is discarded.
  const proposedTargets = propose ? sanitizeTargets(parsed.proposed_targets) : null;
  const targetsRationale =
    proposedTargets && typeof parsed.targets_rationale === 'string' ? parsed.targets_rationale.trim() : null;

  // Throttle: stamp the review time so an adaptive proposal doesn't re-fire until ~a week out
  // (whether or not the user accepts). Merge-write — keeps the macros + other settings intact.
  if (proposeAdaptive) await setMacroTargets(userId, { ...user?.macro_targets, last_reviewed: today() });

  void logAi(userId, {
    kind: 'nutrition_baseline',
    input: { summary },
    output: { raw: raw.slice(0, 2000) },
    meta: { days_logged: summary.days_logged, proposed_targets: !!proposedTargets, adaptive: proposeAdaptive },
  });
  return {
    ready: true,
    read,
    suggestion,
    rationale,
    proposed_targets: proposedTargets,
    targets_rationale: targetsRationale,
  };
}

/** Confirm/edit daily targets (suggest-never-auto-apply: only ever called by the user's tap). Merges
 *  so the non-macro settings (eatback_pct, confirm_below_confidence, last_reviewed) survive a target edit. */
export async function setTargets(userId: string, raw: unknown): Promise<Macros> {
  const t = sanitizeTargets(raw);
  if (!t) throw new Error('no valid targets');
  const { source: _source, ...clean } = t;
  const user = await getUser(userId);
  await setMacroTargets(userId, { ...user?.macro_targets, ...clean });
  return clean;
}

/** Remove targets entirely — back to observe-style, no rings, no "left". */
export async function clearTargets(userId: string): Promise<void> {
  await setMacroTargets(userId, {});
}

/** Set the net-calorie eat-back % (0–100), merged into macro_targets without clobbering the macros. */
export async function setEatbackPct(userId: string, pct: number): Promise<number> {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const user = await getUser(userId);
  const cur = user?.macro_targets ?? {};
  await setMacroTargets(userId, { ...cur, eatback_pct: clamped });
  return clamped;
}

export interface PlateAdvice {
  estimate_kcal: number | null;
  advice: string;
  verdict: 'go' | 'tweak' | 'heavy';
}

/**
 * Pre-eat plate advice (Req 1a): a photo of a plate the user is ABOUT to eat → ONE kind, actionable
 * suggestion, grounded in what they have LEFT today and their goal. Advice only — creates NO nutrition
 * log (this is a "should I?" check, not a record). Reuses the meal-photo upload + vision path.
 */
export async function getPlateAdvice(userId: string, input: { photo?: string; meal?: string }): Promise<PlateAdvice> {
  const date = today();
  const mealText = (input.meal ?? '').trim().slice(0, 500);
  if (!input.photo && !mealText) throw new Error('plate advice needs a photo or a description');

  // A photo uploads and rides as a signed URL; a description rides as a variable. Same job, same
  // audit trail — the read is available whichever way they told us, which is the point: it used
  // to exist ONLY behind the camera, so anyone who typed their meal had no way to ask.
  const photoRef = input.photo ? await putMealPhoto(userId, date, input.photo) : null;
  const [signedUrl, day, goals] = await Promise.all([
    photoRef ? signMealPhotoUrl(photoRef) : Promise.resolve(null),
    getNutritionDay(userId, date),
    listGoalsByStatus(userId, ['confirmed', 'committed']),
  ]);
  const res = await runJobBySlug(
    userId,
    'plate-advice',
    {
      remaining: JSON.stringify(day.left ?? {}),
      goal: JSON.stringify(goals.filter((g) => g.area === 'nourishment').map((g) => g.title)),
      meal: mealText,
    },
    signedUrl ? { images: [signedUrl] } : {},
  );

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(res.formatted ?? res.raw ?? '{}') as Record<string, unknown>;
  } catch {
    /* fall through to the empty-advice guard */
  }
  const advice = typeof parsed.advice === 'string' ? parsed.advice.trim().slice(0, 300) : '';
  if (!advice) throw new Error('plate-advice returned no advice');
  const verdict =
    parsed.verdict === 'go' || parsed.verdict === 'tweak' || parsed.verdict === 'heavy' ? parsed.verdict : 'tweak';
  const estimate_kcal = typeof parsed.estimate_kcal === 'number' ? Math.round(parsed.estimate_kcal / 10) * 10 : null;

  void logAi(userId, {
    kind: 'plate_advice',
    input: { date },
    output: { raw: (res.formatted ?? res.raw ?? '').slice(0, 500) },
    meta: { verdict, estimate_kcal },
  });
  return { estimate_kcal, advice, verdict };
}
