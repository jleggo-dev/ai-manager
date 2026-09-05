/**
 * Reading an amount someone types into a recipe draft.
 *
 * Pure, and its own file, because it is the one place a keystroke becomes a quantity: anything
 * that is not a real amount has to stay unstated rather than quietly becoming a number. The rows
 * this feeds are the ones `structure-recipe` reported `qty: null` for — the person said "some
 * onion" and nobody, model or app, gets to invent the rest.
 */
import type { RecipeIngredientRow } from '../../lib/api.ts';

/** Blank, or anything that is not a positive amount, is still "not stated". */
export function readAmount(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Apply a typed amount to one row, keeping the value and the unstated flag in step. */
export function withAmount(ing: RecipeIngredientRow, raw: string): RecipeIngredientRow {
  const qty = readAmount(raw);
  const next: RecipeIngredientRow = { ...ing, qty };
  if (qty === null) next.amount_unstated = true;
  else delete next.amount_unstated;
  return next;
}
