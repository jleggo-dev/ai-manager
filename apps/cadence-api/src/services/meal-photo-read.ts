/**
 * Reading a meal photo in two steps, so the wait can show its work.
 *
 * One-stage photo logging asks a vision model for JSON and blocks 11–28s on it. Two-stage is
 * better — it commits to a portion, names its assumption, and calibrates its confidence honestly
 * (PLAN.md, 2026-08-21) — but it costs 40–70s, and a minute of spinner is not a feature.
 *
 * The owner's fix, and it is the right one: don't hide the wait, NARRATE it. "Any LLM message takes
 * time; the boredom is alleviated usually by seeing the stream of reasoning." So the pipeline is
 * split at its natural seam and exposed as two calls rather than one:
 *
 *   1. `readMealPhoto`   — upload, then ask the eyes what they see. Returns PROSE, persists nothing.
 *   2. `logMealFromReading` — turn that prose into numbers and write the row.
 *
 * The client rotates its own copy during each call and shows the real reading in between, which is
 * what makes 60s feel like progress instead of a hang. Two calls rather than SSE because the seam
 * buys something a stream would not: **the user can correct the reading before any number is
 * computed from it.** That is the confirm step the brand asks for ("here's what I heard — did I get
 * it right?"), and it is free here rather than bolted on.
 *
 * NOTHING IS PERSISTED BY STEP 1 except the photo itself. A read that the user abandons leaves no
 * meal behind — which is why the row is inserted in step 2 and not before.
 */
import { runJobBySlug } from '../ai/aim.ts';
import { putMealPhoto, signMealPhotoUrl } from './meal-photos.ts';
import { logAi } from './ai-log.ts';
import { insertNutritionLog } from '../repos/nutrition.ts';
import { isMeal, parseMealResult, PROVISIONAL_BELOW } from './nutrition-parse.ts';
import { tickFoodLogOccurrence } from './nutrition.ts';
import { priceParsedMeal } from './food-pricing.ts';
import type { MealKind, Macros, NutritionLog } from '@cadence/shared';

export interface MealPhotoReading {
  photo_ref: string;
  /** The model's prose: what it is, how much, how it was prepared, what it could not tell. */
  reading: string;
  /** Set when the read failed. The caller may still log the meal from the caption alone. */
  error: string | null;
}

/**
 * Step 1 — the photo goes up, the eyes report back in prose.
 *
 * A failure here is NOT fatal and must not read as one: the user still took a photo and may still
 * have typed a caption, so the caller can go on to step 2 with an empty reading and log from words
 * alone. That is the same rule the one-stage path learned on 2026-08-20 — a meal never vanishes
 * because a model did.
 */
export async function readMealPhoto(
  userId: string,
  input: { photo: string; caption?: string; date?: string },
): Promise<MealPhotoReading> {
  // Same UTC day-stamp nutrition.ts uses, so a read and its log can never land on different days.
  const date = input.date || new Date().toISOString().slice(0, 10);
  const photo_ref = await putMealPhoto(userId, date, input.photo);

  try {
    const images = [await signMealPhotoUrl(photo_ref)];
    const res = await runJobBySlug(userId, 'describe-meal-photo', { caption: input.caption ?? '' }, { images });
    const reading = (res.formatted ?? res.raw ?? '').trim();

    void logAi(userId, {
      kind: 'describe_meal_photo',
      input: { caption: input.caption ?? null },
      output: { raw: reading.slice(0, 2000) },
      meta: { photo: true, words: reading.split(/\s+/).filter(Boolean).length },
    });

    return { photo_ref, reading, error: null };
  } catch (e) {
    const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.warn('[nutrition] describe-meal-photo failed — the caller may still log from words:', error);
    void logAi(userId, {
      kind: 'describe_meal_photo',
      input: { caption: input.caption ?? null },
      output: { raw: '' },
      meta: { photo: true, failed: true, error },
    });
    return { photo_ref, reading: '', error };
  }
}

export interface ReadingLogInput {
  photo_ref: string;
  /** The reading AS THE USER IS WILLING TO STAND BEHIND IT — possibly edited. See below. */
  reading: string;
  caption?: string;
  meal?: MealKind;
  date?: string;
}

/**
 * Step 2 — prose to numbers, and the row.
 *
 * `reading` comes back from the CLIENT rather than being cached server-side, and that is the point
 * of splitting here rather than streaming: the user may have corrected it ("that's oat milk", "it
 * was the large one"), and a correction outranks anything the model saw. `parse-meal-description`
 * is told the user is right about WHAT it was and the photo is right about HOW MUCH, so an edited
 * reading wins exactly where it should.
 *
 * No image reaches this job, which means it takes the REMOTE path (see `runJobBySlug`: images ride
 * in-process only) — faster, and testable off a laptop that has no credential encryption key.
 *
 * Every failure rule the one-stage path learned on 2026-08-20 applies unchanged, because they were
 * learned the expensive way: the words survive a failed parse, a parse that produced no numbers is
 * PROVISIONAL rather than a settled zero-calorie meal, and the reason is kept rather than collapsed
 * into an empty string.
 */
export async function logMealFromReading(userId: string, input: ReadingLogInput): Promise<NutritionLog> {
  const date = input.date || new Date().toISOString().slice(0, 10);
  const hint = input.meal && isMeal(input.meal) ? input.meal : undefined;

  let meal: MealKind = hint ?? 'other';
  let items: NutritionLog['items'] = [];
  let flags: NutritionLog['flags'] = {};
  let macros: Macros | null = null;
  let confidence: number | null = null;
  let rawOut = '';
  let parseFailed = false;
  let parseError: string | null = null;

  try {
    const res = await runJobBySlug(userId, 'parse-meal-description', {
      description: input.reading,
      meal_text: input.caption ?? '',
      meal_hint: input.meal ?? '',
    });
    rawOut = res.formatted ?? res.raw ?? '';
    const shaped = parseMealResult(rawOut, hint);
    meal = shaped.meal;
    items = shaped.items;
    flags = shaped.flags;
    macros = shaped.macros;
    confidence = shaped.confidence;
  } catch (e) {
    parseFailed = true;
    parseError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.warn('[nutrition] parse-meal-description failed — storing UNPARSED and provisional:', parseError);
  }

  // Same ledger pass as the words path (A23 §1a) — a photographed parfait and a spoken one resolve
  // to the same pinned food, so they cost the same and only get estimated once between them.
  const ledger = await priceParsedMeal(userId, { items, macros, confidence });
  items = ledger.items;
  macros = ledger.macros;

  const noNumbers = !macros || Object.keys(macros).length === 0;
  const provisional =
    parseFailed ||
    noNumbers ||
    (!ledger.fully_priced && !!macros && confidence !== null && confidence < PROVISIONAL_BELOW);

  const row = await insertNutritionLog(userId, {
    date,
    meal,
    items,
    input_method: 'photo',
    ai_confidence: confidence,
    raw_text: input.caption || null,
    flags,
    photo_ref: input.photo_ref,
    macros,
    provisional,
    // Kept so a number can be explained later, and corrected at its cause rather than its symptom.
    photo_reading: input.reading || null,
  });

  await tickFoodLogOccurrence(userId, date, meal);

  void logAi(userId, {
    kind: 'parse_meal_description',
    input: { caption: input.caption ?? null, reading_words: input.reading.split(/\s+/).filter(Boolean).length },
    output: { raw: rawOut.slice(0, 2000) },
    meta: {
      meal,
      items: items.length,
      confidence,
      macros: !!macros,
      provisional,
      two_stage: true,
      ...(parseFailed ? { parseFailed: true, parseError } : {}),
    },
  });

  return row;
}
