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
import {
  insertNutritionLog,
  listNutritionLogs,
  updateNutritionLog,
  deleteNutritionLog,
  countNutritionDays,
} from '../repos/nutrition.ts';
import { countWaterDays, sumWaterMl } from '../repos/water.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import { getUser, setMacroTargets } from '../repos/users.ts';
import {
  findPendingFoodLogOccurrence,
  findPendingMealOccurrence,
  setOccurrenceStatus,
  listDoneUserOccurrencesForDay,
} from '../repos/occurrences.ts';
import { putMealPhoto, signMealPhotoUrl, signMealPhotoUrls } from './meal-photos.ts';
import { estimateBurnKcal } from './burn.ts';
import { summarizeNutrition } from './nutrition-summarize.ts';
import { sanitizeMacros, sanitizeTargets, sumDay, computeLeft, type DayTotals } from './nutrition-day.ts';
import {
  isMeal,
  parseMealResult,
  usageSlot,
  wantsTargets,
  PROVISIONAL_BELOW,
  type ParsedMealResult,
} from './nutrition-parse.ts';
import { logAi } from './ai-log.ts';
import { logMealFromFood, logMealFromItems, logMealFromRecipe } from './nutrition-log-saved.ts';
import type { PlateItemInput } from './plate-compose.ts';
import { getFoodsByIds } from '../repos/foods.ts';
import { buildNutritionInsight, type NutritionInsightPack } from './nutrition-insight.ts';
import { buildMicroInsightRollup } from './nutrition-insight-micro.ts';
import { OBSERVE_DAYS_NEEDED } from './nutrition-baseline.ts';
export { getBaselineRead } from './nutrition-baseline.ts';
export type { BaselineRead } from './nutrition-baseline.ts';
import { priceParsedMeal } from './food-pricing.ts';
import { totalsFromItems } from './meal-corrections.ts';
import { enrichFlags } from './meal-enrich.ts';

export { parseMealResult, wantsTargets, PROVISIONAL_BELOW, isMeal } from './nutrition-parse.ts';
export type { ParsedMealResult } from './nutrition-parse.ts';
export { logMealFromFood, logMealFromRecipe } from './nutrition-log-saved.ts';
export type { NutritionInsightPack } from './nutrition-insight.ts';

const today = (): string => new Date().toISOString().slice(0, 10);

/** Exported for the two-stage photo path (meal-photo-read.ts), which writes its own row. */
export async function tickFoodLogOccurrence(userId: string, date: string, meal?: string): Promise<void> {
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
  // Price the card the user is about to see (A23 §1a) — but PIN NOTHING. A preview they walk away
  // from must leave no food behind, the same rule the photo read follows. The confirm does the
  // pinning, and pricing is deterministic, so what lands is what the card showed.
  const ledger = await priceParsedMeal(
    userId,
    { items: shaped.items, macros: shaped.macros, confidence: shaped.confidence },
    { pin: false, slot: usageSlot(today(), shaped.meal) },
  );
  void logAi(userId, {
    kind: 'parse_meal',
    input: { text: trimmed, meal_hint: mealHint ?? null, preview: true },
    output: { raw: rawOut.slice(0, 2000) },
    meta: {
      meal: shaped.meal,
      items: shaped.items.length,
      confidence: shaped.confidence,
      preview: true,
      ledger_priced: ledger.fully_priced,
    },
  });
  return { ...shaped, items: ledger.items, macros: ledger.macros, raw_text: trimmed };
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
    // Re-priced server-side rather than trusted: the preview's wire shape drops `food_id`, so this
    // is where the confirmed meal earns its ledger link and pins whatever was new. Deterministic,
    // so the numbers match the card the user tapped — this fills the ledger, it does not overrule
    // them (a correction still lands through correct_log, as `source: 'user'`).
    const ledger = await priceParsedMeal(
      userId,
      { items, macros, confidence: p.confidence },
      { slot: usageSlot(date, p.meal) },
    );
    const provisional =
      !ledger.fully_priced && !!ledger.macros && p.confidence !== null && p.confidence < PROVISIONAL_BELOW;
    const row = await insertNutritionLog(userId, {
      date,
      meal: p.meal,
      items: ledger.items,
      input_method: 'text',
      ai_confidence: p.confidence,
      raw_text: p.raw_text || null,
      flags: { ...p.flags, ...enrichFlags(ledger.wants_research) },
      photo_ref: null,
      macros: ledger.macros,
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
  /** Set when the parse threw — the row must not read as a confirmed zero-calorie meal. */
  let parseFailed = false;
  let parseError: string | null = null;
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
    /**
     * The words survive a parse failure — that has always been right. What was wrong is what
     * happened NEXT: `provisional` is computed from `!!macros`, so a parse that produced NOTHING
     * came out `provisional: false` and the meal was stored as a SETTLED entry worth zero calories.
     * The owner logged two photos on 2026-08-20 and got exactly that: raw_text kept, `items: []`,
     * `macros: {}`, `provisional: false`, silently counted as 0 kcal in his day.
     *
     * And the diagnosis was destroyed with it: this catch collapsed every cause — a provider 401,
     * an unreachable image, a model returning empty — into one empty string, so `ai_log` recorded
     * `{"raw": ""}` and nothing could say why. Same rule tool-response.ts already enforces for the
     * coach: an ERROR must never look like an empty result.
     */
    parseFailed = true;
    parseError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.warn('[nutrition] parse-meal failed — storing the meal UNPARSED and provisional:', parseError);
  }

  // The parse said WHAT it was; the ledger says what it costs (A23 §1a). Every item it can match
  // to a saved food is repriced from that food, and every item it cannot is pinned as one — so the
  // same words logged tomorrow produce the same numbers instead of a fresh guess.
  const ledger = await priceParsedMeal(userId, { items, macros, confidence }, { slot: usageSlot(date, meal) });
  items = ledger.items;
  macros = ledger.macros;

  // Low-confidence estimates are provisional: listed, but excluded from totals until confirmed.
  // So is a meal with NO numbers at all — a failed parse, or one that produced nothing usable.
  // Provisional keeps it out of the day's totals and visibly awaiting a confirm, which is the
  // honest reading; a confirmed 0 kcal quietly drags the day down and looks settled doing it.
  // A fully ledger-priced meal is exempt: the confidence gate is about how well the MODEL guessed
  // the numbers, and there is no guess left in a meal whose every item came from a food row.
  const noNumbers = !macros || Object.keys(macros).length === 0;
  const provisional =
    parseFailed ||
    noNumbers ||
    (!ledger.fully_priced && !!macros && confidence !== null && confidence < PROVISIONAL_BELOW);

  const row = await insertNutritionLog(userId, {
    date,
    meal,
    items,
    input_method: photoRef ? 'photo' : 'text',
    ai_confidence: confidence,
    raw_text: text || null,
    flags: { ...flags, ...enrichFlags(ledger.wants_research) },
    photo_ref: photoRef,
    macros,
    provisional,
  });

  await tickFoodLogOccurrence(userId, date, meal);

  void logAi(userId, {
    kind: 'parse_meal',
    input: { text, meal_hint: input.meal ?? null },
    output: { raw: rawOut.slice(0, 2000) },
    meta: {
      meal,
      items: items.length,
      flags,
      confidence,
      photo: !!photoRef,
      macros: !!macros,
      provisional,
      // Why it was empty, and when: the difference between "the model saw nothing" and "the call
      // never landed" is the whole diagnosis, and it used to be thrown away.
      ...(parseFailed ? { parseFailed: true, parseError } : {}),
    },
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
  /**
   * How far they are from EARNING a calorie target, when they have none yet (owner 2026-08-18).
   *
   * The baseline flow refuses to propose targets until 7 distinct days are logged — defensible,
   * a number from one meal is a guess dressed as a plan — but the wait was invisible: "Lose
   * weight" sat committed with no target, no explanation and no path, which breaks the promise
   * harder than the missing ring did. Present only while a goal WANTS targets and none are set,
   * so the card can show a countdown instead of nothing.
   */
  targets_wait: { days_logged: number; days_needed: number } | null;
  /**
   * Any food signal in the trailing 14 days (or targets set, which proves the module is in use).
   * The trail's food strip is the DOOR to the food module, and a door must not be gated on the
   * things behind it (device report 2026-08-15): with no target and no countdown, this is what
   * keeps the strip — dashed, counting — for someone who logs food without a goal that wants
   * targets. False only when food is truly idle, so a mind-only user never grows a calorie strip.
   */
  has_recent_food: boolean;
  /** The day's water, ml (0037). Zero is an honest number — water has no provisional state. */
  water_ml: number;
  /** Any pour in the trailing 14 days — the quick-add sheet's water-row gate, same window and
   *  same reasoning as `has_recent_food`: offer the tap to someone already tracking water, never
   *  grow a water row on someone who has never poured one. */
  has_recent_water: boolean;
}

/** One day's meals + deterministic totals (confirmed vs provisional) + targets/left when set. `left`
 *  reflects NET calories: base kcal target + the eaten-back share of today's estimated exercise burn. */
export async function getNutritionDay(userId: string, date?: string): Promise<NutritionDay> {
  const d = date ?? today();
  const [rows, user, done, water_ml] = await Promise.all([
    listNutritionLogs(userId, d, d),
    getUser(userId),
    listDoneUserOccurrencesForDay(userId, d),
    sumWaterMl(userId, d),
  ]);
  let meals = rows;
  try {
    meals = await signMealPhotoUrls(rows);
  } catch (e) {
    console.warn('[nutrition] day photo signing failed — returning rows without photos:', e);
  }
  const sums = sumDay(rows);
  const targets = user?.macro_targets ?? null;

  // No targets yet: is that "not tracking", or "tracking, and the target is still being earned"?
  // Only the second gets a countdown, and only a goal that warrants targets makes it the second.
  let targets_wait: NutritionDay['targets_wait'] = null;
  if (!targets || typeof targets.kcal !== 'number') {
    const goals = await listGoalsByStatus(userId, ['confirmed', 'committed']);
    if (wantsTargets(goals)) {
      const from = new Date(Date.parse(`${d}T00:00:00Z`) - 13 * 86_400_000).toISOString().slice(0, 10);
      targets_wait = {
        days_logged: Math.min(await countNutritionDays(userId, from, d), OBSERVE_DAYS_NEEDED),
        days_needed: OBSERVE_DAYS_NEEDED,
      };
    }
  }

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

  // The strip is the module's door, so "is food active at all?" must not cost a query when the
  // answer is already on the table: today's rows, a kcal target, or the countdown's own count.
  let has_recent_food = rows.length > 0 || typeof targets?.kcal === 'number';
  if (!has_recent_food) {
    if (targets_wait) {
      has_recent_food = targets_wait.days_logged > 0;
    } else {
      const from = new Date(Date.parse(`${d}T00:00:00Z`) - 13 * 86_400_000).toISOString().slice(0, 10);
      has_recent_food = (await countNutritionDays(userId, from, d)) > 0;
    }
  }

  // Same shortcut shape: today's pour already on the table answers it for free.
  let has_recent_water = water_ml > 0;
  if (!has_recent_water) {
    const from = new Date(Date.parse(`${d}T00:00:00Z`) - 13 * 86_400_000).toISOString().slice(0, 10);
    has_recent_water = (await countWaterDays(userId, from, d)) > 0;
  }

  return {
    date: d,
    meals,
    ...sums,
    targets,
    left: computeLeft(effective, sums.totals),
    burn_kcal,
    eatback_kcal,
    eatback_pct,
    targets_wait,
    has_recent_food,
    water_ml,
    has_recent_water,
  };
}

/**
 * Tap-to-correct/confirm (spec S3): the user's word always wins. A bare confirm keeps the AI's
 * numbers but graduates them into the totals; any provided macros are sanitized and marked
 * source 'user' with full confidence.
 */
/**
 * Take a meal back off the day. See `deleteNutritionLog` for when this is the right move and when
 * a correction is: this is for a meal that did not happen.
 */
export async function removeMeal(userId: string, logId: string): Promise<boolean> {
  return deleteNutritionLog(userId, logId);
}

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
  } else if (update.items) {
    /**
     * A meal's macros are STORED, not derived — so editing items without this leaves the old
     * arithmetic sitting on the day. That is how a phantom item keeps contributing its sodium
     * after the user has deleted it, which is exactly the repair they came here to make.
     * Recomputed from the items themselves; a client-sent total is never trusted.
     */
    // Assigned UNCONDITIONALLY. `totalsFromItems` returns null when nothing is left to add up,
    // and an earlier `if (recomputed)` guard here meant dropping the LAST item left the meal's old
    // totals in place — zero items still contributing 215 kcal and 675 mg of sodium to the day.
    // The empty case is the one that most needs writing, not the one to skip.
    update.macros = { ...(totalsFromItems(update.items) ?? {}), source: 'user' };
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

/** Confirm/edit daily targets (suggest-never-auto-apply: only ever called by the user's tap). Merges
 *  so the non-macro settings (eatback_pct, confirm_below_confidence, last_reviewed) survive a target edit. */
export async function setTargets(userId: string, raw: unknown): Promise<Macros> {
  const t = sanitizeTargets(raw);
  if (!t) throw new Error('no valid targets');
  const { source: _source, ...clean } = t;
  const user = await getUser(userId);
  const prev = user?.macro_targets ?? {};

  // A23 §3 — keep a short trail of kcal moves so the ratchet has a memory. Without it the loop
  // cannot know it has already cut twice this month, and a plateau (which looks exactly like "the
  // deficit is too small") would buy a third cut. Trimmed to the last 12: this is a guardrail's
  // working memory, not an audit log.
  const prevKcal = typeof prev.kcal === 'number' ? prev.kcal : null;
  const nextKcal = typeof clean.kcal === 'number' ? clean.kcal : null;
  const trail: NonNullable<MacroTargets['adjustments']> = Array.isArray(prev.adjustments) ? prev.adjustments : [];
  const adjustments =
    prevKcal !== null && nextKcal !== null && prevKcal !== nextKcal
      ? [...trail, { date: today(), from: prevKcal, to: nextKcal }].slice(-12)
      : trail;

  await setMacroTargets(userId, { ...prev, ...clean, ...(adjustments.length ? { adjustments } : {}) });
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
