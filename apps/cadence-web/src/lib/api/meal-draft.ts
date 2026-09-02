/**
 * The draft-meal client (meal-logging rework, 2026-09-02) — the meal is the unit of the write.
 *
 * This file IS the client↔server contract for the rework: the server routes are built to match
 * it and the meal screen consumes it. Draft operations throw on failure (the screen owns the
 * error surface); reads soft-fail to null. Every mutation returns the updated meal so the client
 * never re-derives state the server just computed.
 */
import type { MealKind, MealPart, NutritionLog, PendingFoodSweep, Recipe } from '@cadence/shared';
import { BASE, headers, timeoutSignal } from './http.ts';

export type Meal = NutritionLog & { log_id: string };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: headers(), signal: timeoutSignal(20000), ...init });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return call<T>(path, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function patch<T>(path: string, body: unknown): Promise<T> {
  return call<T>(path, {
    method: 'PATCH',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/* ── The draft lifecycle ─────────────────────────────────────────────────── */

/**
 * Open (or rejoin) the draft for a slot. Idempotent per (date, meal): while a draft for that slot
 * is still inside its window, the same one comes back — the 09:40 latte joins breakfast.
 */
export async function openMealDraft(input: { meal?: MealKind; date?: string }): Promise<Meal> {
  const r = await post<{ meal: Meal }>('/nutrition/meals/draft', input);
  return r.meal;
}

/** The one open meal, if any — how a reopened app finds its way back into breakfast. */
export async function getOpenMeal(): Promise<Meal | null> {
  try {
    const r = await call<{ meal: Meal | null }>('/nutrition/meals/open');
    return r.meal;
  } catch {
    return null;
  }
}

/** Append one resolved food at a serving (defaults to the food's own default serving). */
export async function appendFood(
  logId: string,
  input: { food_id: string; serving_index?: number; quantity?: number },
): Promise<Meal> {
  const r = await post<{ meal: Meal }>(`/nutrition/meals/${encodeURIComponent(logId)}/items`, input);
  return r.meal;
}

/**
 * Append a cookbook recipe as a part (the bracket): the part's items are a SNAPSHOT of the
 * recipe's ingredients scaled to `servings` of its yield — cookbook edits never reach backwards.
 */
export async function appendRecipe(logId: string, input: { recipe_id: string; servings?: number }): Promise<Meal> {
  const r = await post<{ meal: Meal }>(`/nutrition/meals/${encodeURIComponent(logId)}/items`, input);
  return r.meal;
}

/**
 * Append rows a parser already produced (the chat/voice/photo doors) — passed through verbatim,
 * never re-parsed. Items keep their given/assumed/asked amounts exactly as MealPreview holds them.
 */
export async function appendParsed(
  logId: string,
  input: { items: { name: string; brand?: string; qty?: number; unit?: string; est?: object; food_id?: string }[] },
): Promise<Meal> {
  const r = await post<{ meal: Meal }>(`/nutrition/meals/${encodeURIComponent(logId)}/items`, { parsed: input.items });
  return r.meal;
}

/** Take an item back out of the draft (the strip's Undo, a row's ×). An emptied draft stays open. */
export async function removeDraftItem(logId: string, index: number): Promise<Meal> {
  const r = await post<{ meal: Meal }>(`/nutrition/meals/${encodeURIComponent(logId)}/items/remove`, { index });
  return r.meal;
}

/** A stepper nudge — set one item's quantity. Macros rescale server-side. */
export async function setDraftAmount(logId: string, index: number, qty: number): Promise<Meal> {
  const r = await patch<{ meal: Meal }>(`/nutrition/meals/${encodeURIComponent(logId)}/amount`, { index, qty });
  return r.meal;
}

/** Move the draft to another slot (the header chip, asked once, changeable in one tap). */
export async function setDraftMeal(logId: string, meal: MealKind): Promise<Meal> {
  const r = await patch<{ meal: Meal }>(`/nutrition/meals/${encodeURIComponent(logId)}/slot`, { meal });
  return r.meal;
}

/** Close the meal — the commit. An empty draft closes to nothing (returns null, row deleted). */
export async function closeMeal(logId: string): Promise<Meal | null> {
  const r = await post<{ meal: Meal | null }>(`/nutrition/meals/${encodeURIComponent(logId)}/close`);
  return r.meal;
}

/* ── Parts (the bracket) ─────────────────────────────────────────────────── */

export type MealPartOp =
  | { op: 'group'; item_indexes: number[]; name?: string | null }
  | { op: 'ungroup'; part: string }
  | { op: 'rename'; part: string; name: string }
  | { op: 'set_yield'; part: string; yield_servings: number; servings_logged?: number }
  | { op: 'add'; part: string; index: number }
  | { op: 'remove'; part: string; index: number };

/**
 * All bracket edits, one door. The server enforces the grammar: no nested parts, a part with
 * fewer than two members dissolves on its own, and no op ever changes the meal's numbers.
 * Works on open AND closed meals — grouping the past is legal, it only changes the read-back.
 */
export async function editMealParts(logId: string, op: MealPartOp): Promise<Meal> {
  const r = await patch<{ meal: Meal }>(`/nutrition/meals/${encodeURIComponent(logId)}/parts`, op);
  return r.meal;
}

/** Name a part into the cookbook — naming and saving are the same act. Snapshot semantics. */
export async function savePartAsRecipe(
  logId: string,
  input: { part: string; name: string; yield_servings?: number },
): Promise<{ recipe: Recipe; meal: Meal }> {
  return post<{ recipe: Recipe; meal: Meal }>(`/nutrition/meals/${encodeURIComponent(logId)}/save-part`, input);
}

/* ── The Sunday sweep (S3/S4) ────────────────────────────────────────────── */

export async function getFoodSweep(): Promise<PendingFoodSweep | null> {
  try {
    const r = await call<{ sweep: PendingFoodSweep | null }>('/nutrition/sweep');
    return r.sweep;
  } catch {
    return null;
  }
}

/** One commit for the toggled subset — never per-proposal accepts. */
export async function commitFoodSweep(
  acceptIds: string[],
): Promise<{ saved: Recipe[]; tidy: { proposal_id: string; log_count: number }[] }> {
  return post('/nutrition/sweep/commit', { accept: acceptIds });
}

/** The retro tidy — opt-in, adds sweep-tagged parts to the week behind you. Same numbers. */
export async function tidyFoodSweep(proposalIds: string[]): Promise<{ tidied: number }> {
  return post('/nutrition/sweep/tidy', { proposal_ids: proposalIds });
}

/** Reverse a tidy: every sweep-tagged part comes back off. Nothing else is touched. */
export async function revertFoodTidy(): Promise<{ reverted: number }> {
  return post('/nutrition/sweep/tidy/revert');
}

export async function dismissFoodSweep(): Promise<void> {
  await post('/nutrition/sweep/dismiss');
}

/** Re-export for consumers of the sweep card. */
export type { MealPart, PendingFoodSweep };
