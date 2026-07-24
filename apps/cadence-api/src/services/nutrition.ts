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
import { insertNutritionLog, listNutritionLogs, updateNutritionLog } from '../repos/nutrition.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import { getUser, setMacroTargets } from '../repos/users.ts';
import {
  findPendingFoodLogOccurrence,
  setOccurrenceStatus,
  listDoneUserOccurrencesForDay,
  listWeighInSeries,
} from '../repos/occurrences.ts';
import { putMealPhoto, signMealPhotoUrl, signMealPhotoUrls } from './meal-photos.ts';
import { estimateBurnKcal } from './burn.ts';
import { actualWeeklyRate, safeWeeklyKg, classifyLossPace } from './weight-trend.ts';
import { summarizeNutrition } from './nutrition-summarize.ts';
import { sanitizeMacros, sanitizeTargets, sumDay, computeLeft, type DayTotals } from './nutrition-day.ts';
import { isMeal, parseMealResult, wantsTargets, PROVISIONAL_BELOW } from './nutrition-parse.ts';
import { logAi } from './ai-log.ts';
import type { Macros, MacroTargets, MealKind, NutritionLog, NutritionSummary } from '@cadence/shared';

export { parseMealResult, wantsTargets, PROVISIONAL_BELOW, isMeal } from './nutrition-parse.ts';
export type { ParsedMealResult } from './nutrition-parse.ts';

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * Record one meal from the user's words and/or a photo. Parse is best-effort — on any failure
 * the raw text is still stored (meal = hint or 'other', items empty) so nothing they said is
 * lost. A photo uploads to private Storage FIRST (capture-first: items stay empty unless a
 * caption was given — the engine can't read images yet, backlog §F; photo_ref makes every photo
 * retroactively parseable). Side effect: the first meal of the day ticks today's pending
 * "Food log" system occurrence done (the deterministic title test, mirroring weigh-in).
 */
export async function logMeal(
  userId: string,
  input: { text?: string; meal?: MealKind; date?: string; photo?: string },
): Promise<NutritionLog> {
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
export async function getPlateAdvice(userId: string, photoDataUrl: string): Promise<PlateAdvice> {
  const date = today();
  const photoRef = await putMealPhoto(userId, date, photoDataUrl);
  const [signedUrl, day, goals] = await Promise.all([
    signMealPhotoUrl(photoRef),
    getNutritionDay(userId, date),
    listGoalsByStatus(userId, ['confirmed', 'committed']),
  ]);
  const res = await runJobBySlug(
    userId,
    'plate-advice',
    {
      remaining: JSON.stringify(day.left ?? {}),
      goal: JSON.stringify(goals.filter((g) => g.area === 'nourishment').map((g) => g.title)),
    },
    { images: [signedUrl] },
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
