/**
 * Req 5 WS2 — Food capture: label photo / describe / front-of-pack → unsaved Food candidate.
 * All AI via AI Admin jobs (parse-nutrition-label, estimate-food, identify-food); app asserts.
 * Reuses meal-photo Storage (private bucket + short-lived signed URLs for vision).
 */
import { runJobBySlug } from '../ai/aim.ts';
import { logAi } from './ai-log.ts';
import { putMealPhoto, signMealPhotoUrl } from './meal-photos.ts';
import {
  parseEstimateResult,
  parseIdentifyResult,
  parseLabelResult,
  type FoodCandidate,
  type ParsedIdentifyCapture,
  type ParsedLabelCapture,
} from './food-capture-parse.ts';

export type { FoodCandidate, ParsedIdentifyCapture, ParsedLabelCapture } from './food-capture-parse.ts';

const today = (): string => new Date().toISOString().slice(0, 10);

async function uploadAndSign(userId: string, photoDataUrl: string): Promise<{ photoRef: string; signedUrl: string }> {
  const photoRef = await putMealPhoto(userId, today(), photoDataUrl);
  const signedUrl = await signMealPhotoUrl(photoRef);
  return { photoRef, signedUrl };
}

/**
 * Nutrition Facts panel photo → unsaved food candidate (Gemini vision via parse-nutrition-label).
 * Does NOT persist — caller confirms via POST /nutrition/foods.
 */
export async function parseNutritionLabel(
  userId: string,
  input: { photo: string; hint?: string; name?: string; brand?: string | null },
): Promise<ParsedLabelCapture> {
  const { photoRef, signedUrl } = await uploadAndSign(userId, input.photo);
  let rawOut = '';
  try {
    const res = await runJobBySlug(
      userId,
      'parse-nutrition-label',
      { hint: (input.hint ?? '').trim().slice(0, 200) },
      { images: [signedUrl] },
    );
    rawOut = res.formatted ?? res.raw ?? '';
    const shaped = parseLabelResult(rawOut, {
      photoRef,
      nameOverride: input.name,
      brandOverride: input.brand,
    });
    void logAi(userId, {
      kind: 'parse_nutrition_label',
      input: { hint: input.hint ?? null, name: input.name ?? null },
      output: { raw: rawOut.slice(0, 2000) },
      meta: {
        photo_ref: photoRef,
        label_readable: shaped.label_readable,
        confidence: shaped.candidate.confidence,
      },
    });
    return shaped;
  } catch (e) {
    console.warn('[food-capture] parse-nutrition-label failed:', e);
    void logAi(userId, {
      kind: 'parse_nutrition_label',
      input: { hint: input.hint ?? null },
      output: { raw: rawOut.slice(0, 500), error: e instanceof Error ? e.message : String(e) },
      meta: { photo_ref: photoRef },
    });
    throw e instanceof Error ? e : new Error('parse-nutrition-label failed');
  }
}

/**
 * Describe-a-food text → unsaved food candidate (estimate-food). Macros only — no micros.
 */
export async function estimateFood(userId: string, foodText: string): Promise<FoodCandidate> {
  const text = foodText.trim().slice(0, 500);
  if (!text) throw new Error('food text required');
  let rawOut = '';
  try {
    const res = await runJobBySlug(userId, 'estimate-food', { food_text: text });
    rawOut = res.formatted ?? res.raw ?? '';
    const candidate = parseEstimateResult(rawOut);
    void logAi(userId, {
      kind: 'estimate_food',
      input: { food_text: text },
      output: { raw: rawOut.slice(0, 2000) },
      meta: { confidence: candidate.confidence, name: candidate.name },
    });
    return candidate;
  } catch (e) {
    console.warn('[food-capture] estimate-food failed:', e);
    void logAi(userId, {
      kind: 'estimate_food',
      input: { food_text: text },
      output: { raw: rawOut.slice(0, 500), error: e instanceof Error ? e.message : String(e) },
      meta: {},
    });
    throw e instanceof Error ? e : new Error('estimate-food failed');
  }
}

/**
 * Front-of-package photo → name + brand (identify-food). No macros.
 * Pairs with parse-nutrition-label when the panel photo has no product name.
 */
export async function identifyFood(
  userId: string,
  input: { photo: string; hint?: string },
): Promise<ParsedIdentifyCapture> {
  const { photoRef, signedUrl } = await uploadAndSign(userId, input.photo);
  let rawOut = '';
  try {
    const res = await runJobBySlug(
      userId,
      'identify-food',
      { hint: (input.hint ?? '').trim().slice(0, 200) },
      { images: [signedUrl] },
    );
    rawOut = res.formatted ?? res.raw ?? '';
    const shaped = parseIdentifyResult(rawOut, photoRef);
    void logAi(userId, {
      kind: 'identify_food',
      input: { hint: input.hint ?? null },
      output: { raw: rawOut.slice(0, 2000) },
      meta: { photo_ref: photoRef, confidence: shaped.confidence, name: shaped.name },
    });
    return shaped;
  } catch (e) {
    console.warn('[food-capture] identify-food failed:', e);
    void logAi(userId, {
      kind: 'identify_food',
      input: { hint: input.hint ?? null },
      output: { raw: rawOut.slice(0, 500), error: e instanceof Error ? e.message : String(e) },
      meta: { photo_ref: photoRef },
    });
    throw e instanceof Error ? e : new Error('identify-food failed');
  }
}
