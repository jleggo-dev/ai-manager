/**
 * POST /nutrition/foods/resolve — WS-R confirm-first ranking (no AI).
 * Soft-handles 404/network so the Food tab can fall back to estimate/search.
 */

import { BASE, headers } from './http.ts';
import type { ApiAvailability, FoodSummary } from './foods.ts';

export type ResolveCandidateKind = 'food' | 'recipe' | 'new';
export type ResolveCapturePath = 'estimate' | 'parse-label';

export interface ResolveCaptureHint {
  path: ResolveCapturePath;
  text?: string;
}

export interface ResolveCandidate {
  kind: ResolveCandidateKind;
  score: number;
  label: string;
  food_id?: string;
  recipe_id?: string;
  brand?: string | null;
  preselected_serving?: number;
  inferred_quantity?: number;
  capture?: ResolveCaptureHint;
}

export interface ResolveFoodsResult {
  status: ApiAvailability;
  candidates: ResolveCandidate[];
  preselected: ResolveCandidate | null;
  message?: string;
}

/** Portion hints from the resolver for the confirm sheet. */
export interface ResolvePortionHint {
  servingIndex?: number;
  quantity?: number;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

function parseCapture(raw: unknown): ResolveCaptureHint | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.path !== 'estimate' && raw.path !== 'parse-label') return undefined;
  return {
    path: raw.path,
    ...(typeof raw.text === 'string' ? { text: raw.text } : {}),
  };
}

function parseCandidate(raw: unknown): ResolveCandidate | null {
  if (!isRecord(raw)) return null;
  if (raw.kind !== 'food' && raw.kind !== 'recipe' && raw.kind !== 'new') return null;
  if (typeof raw.label !== 'string' || !raw.label.trim()) return null;
  const score = typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : 0;
  return {
    kind: raw.kind,
    score,
    label: raw.label.trim(),
    ...(typeof raw.food_id === 'string' ? { food_id: raw.food_id } : {}),
    ...(typeof raw.recipe_id === 'string' ? { recipe_id: raw.recipe_id } : {}),
    brand: typeof raw.brand === 'string' ? raw.brand : raw.brand === null ? null : undefined,
    ...(typeof raw.preselected_serving === 'number' && Number.isInteger(raw.preselected_serving)
      ? { preselected_serving: raw.preselected_serving }
      : {}),
    ...(typeof raw.inferred_quantity === 'number' && Number.isFinite(raw.inferred_quantity)
      ? { inferred_quantity: raw.inferred_quantity }
      : {}),
    ...(raw.capture ? { capture: parseCapture(raw.capture) } : {}),
  };
}

/** Map a resolve food candidate to the list-row shape (name/brand for display). */
export function foodSummaryFromResolve(c: ResolveCandidate): FoodSummary | null {
  if (c.kind !== 'food' || !c.food_id) return null;
  let name = c.label;
  const brand = typeof c.brand === 'string' ? c.brand : null;
  if (brand && name.endsWith(` (${brand})`)) name = name.slice(0, -(brand.length + 3)).trim();
  return {
    food_id: c.food_id,
    name: name || c.label,
    brand,
    serving_label:
      typeof c.preselected_serving === 'number'
        ? c.inferred_quantity != null && c.inferred_quantity !== 1
          ? `×${c.inferred_quantity}`
          : null
        : null,
  };
}

export function portionHintFromResolve(c: ResolveCandidate): ResolvePortionHint {
  const hint: ResolvePortionHint = {};
  if (typeof c.preselected_serving === 'number' && Number.isInteger(c.preselected_serving))
    hint.servingIndex = Math.max(0, c.preselected_serving);
  if (typeof c.inferred_quantity === 'number' && Number.isFinite(c.inferred_quantity) && c.inferred_quantity > 0)
    hint.quantity = c.inferred_quantity;
  return hint;
}

/** POST /nutrition/foods/resolve — ranked candidates + optional clear-best preselect. */
export async function resolveFoods(input: { text?: string; photo?: string } = {}): Promise<ResolveFoodsResult> {
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  const photo = typeof input.photo === 'string' ? input.photo : undefined;
  try {
    const res = await fetch(`${BASE}/nutrition/foods/resolve`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        ...(text ? { text } : {}),
        ...(photo ? { photo } : {}),
      }),
    });
    if (res.status === 404) {
      return {
        status: 'unavailable',
        candidates: [],
        preselected: null,
        message: "Food resolve isn't reachable just now — try saying it again in a moment.",
      };
    }
    if (!res.ok) {
      return {
        status: 'error',
        candidates: [],
        preselected: null,
        message: "Couldn't resolve that just now — try again in a moment.",
      };
    }
    const body = await readJson(res);
    if (!isRecord(body)) {
      return { status: 'error', candidates: [], preselected: null, message: "Couldn't read resolve results." };
    }
    const rawList = Array.isArray(body.candidates) ? body.candidates : [];
    const candidates: ResolveCandidate[] = [];
    for (const row of rawList) {
      const c = parseCandidate(row);
      if (c) candidates.push(c);
    }
    const preselected = parseCandidate(body.preselected);
    return {
      status: 'ok',
      candidates,
      preselected: preselected && preselected.kind !== 'new' ? preselected : null,
    };
  } catch {
    return {
      status: 'error',
      candidates: [],
      preselected: null,
      message: "Couldn't reach food resolve — try again in a moment.",
    };
  }
}
