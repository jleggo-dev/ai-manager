/**
 * Pure helpers for parse_fridge_photo + generate_recipe job output.
 * No DB / AI Admin imports — unit-testable without CADENCE_* secrets.
 */
import { parseStructureRecipeResult, type StructuredRecipe } from './recipe-parse.ts';

export interface FridgeIngredient {
  name: string;
  qty?: number;
  unit?: string;
}

export interface ParsedFridgePhoto {
  ingredients: FridgeIngredient[];
  summary: string;
  confidence: number;
  photo_readable: boolean;
  photo_ref: string | null;
}

export interface GeneratedRecipeBundle {
  recipes: StructuredRecipe[];
  notes: string | null;
  /** Optional tags per recipe index (aligned with recipes[]). */
  tags: string[][];
}

function asTrimmedString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

function asOptionalPositive(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function clampConfidence(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

function parseFridgeIngredient(raw: unknown): FridgeIngredient | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = asTrimmedString(o.name);
  if (!name) return null;
  const qty = asOptionalPositive(o.qty);
  const unit = asTrimmedString(o.unit) ?? undefined;
  const row: FridgeIngredient = { name: name.slice(0, 80) };
  if (qty !== undefined) row.qty = qty;
  if (unit) row.unit = unit.slice(0, 24);
  return row;
}

/**
 * Assert + sanitize parse_fridge_photo JSON.
 * Unreadable photos may return empty ingredients (caller surfaces a warm message).
 */
export function parseFridgePhotoResult(raw: string, photoRef?: string | null): ParsedFridgePhoto {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('parse_fridge_photo returned non-JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('parse_fridge_photo returned empty result');
  const o = parsed as Record<string, unknown>;

  const photo_readable = o.photo_readable !== false;
  const ingredientsRaw = Array.isArray(o.ingredients) ? o.ingredients : [];
  const ingredients = ingredientsRaw
    .map(parseFridgeIngredient)
    .filter((i): i is FridgeIngredient => i !== null)
    .slice(0, 40);

  const summary =
    asTrimmedString(o.summary)?.slice(0, 240) ?? (ingredients.length ? ingredients.map((i) => i.name).join(', ') : '');

  let confidence = clampConfidence(o.confidence, photo_readable ? 0.5 : 0.2);
  if (!photo_readable) confidence = Math.min(confidence, 0.3);

  return {
    ingredients: photo_readable ? ingredients : [],
    summary,
    confidence,
    photo_readable,
    photo_ref: photoRef ?? null,
  };
}

function parseTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 3);
}

/**
 * Assert + sanitize generate_recipe JSON → structured recipes (macros still unresolved).
 */
export function parseGenerateRecipeResult(raw: string): GeneratedRecipeBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('generate_recipe returned non-JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('generate_recipe returned empty result');
  const o = parsed as Record<string, unknown>;
  const list = Array.isArray(o.recipes) ? o.recipes : [];
  const recipes: StructuredRecipe[] = [];
  const tags: string[][] = [];

  for (const row of list.slice(0, 3)) {
    if (!row || typeof row !== 'object') continue;
    try {
      const structured = parseStructureRecipeResult(JSON.stringify(row));
      recipes.push(structured);
      tags.push(parseTags((row as Record<string, unknown>).tags));
    } catch (e) {
      console.warn('[fridge-parse] skip unusable generated recipe:', e);
    }
  }

  const notes = asTrimmedString(o.notes);
  return { recipes, notes, tags };
}

/** Normalize a reviewed ingredient list for the generate_recipe job variable. */
export function formatIngredientsForJob(ingredients: FridgeIngredient[]): string {
  return ingredients
    .map((i) => {
      const qty = i.qty != null ? String(i.qty) : '';
      const unit = i.unit ?? '';
      return [qty, unit, i.name].filter(Boolean).join(' ').trim();
    })
    .filter(Boolean)
    .join('; ');
}

/** Coerce reviewed UI rows into FridgeIngredient[]. */
export function coerceFridgeIngredients(raw: unknown): FridgeIngredient[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(parseFridgeIngredient)
    .filter((i): i is FridgeIngredient => i !== null)
    .slice(0, 40);
}
