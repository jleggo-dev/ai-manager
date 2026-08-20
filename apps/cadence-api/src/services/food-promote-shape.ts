/**
 * Turning one parsed meal item into a reusable Food — the pure half (no DB, no AI).
 *
 * Req 5 §1: "Real nutrition tracking is fast BECAUSE it remembers foods." Everything logged by
 * words or photo used to stop at a `nutrition_logs` row, so the thing someone actually ate never
 * became a Food, never entered recents/frequents, and could never be found again. This module
 * decides two things about such an item: **what shape of Food it would be**, and **whether the
 * user already has that food** — because logging "starbucks latte" twice must bump one food, not
 * mint twins.
 */
import {
  scaleNutrients,
  type Food,
  type FoodBaseUnit,
  type FoodNutrients,
  type FoodServing,
  type Macros,
} from '@cadence/shared';
import { lexicalMatchScore, normalizeResolveText } from './food-resolver-rank.ts';

/** One item off a parsed meal — the shape `NutritionLog['items']` carries. */
export interface LoggedItem {
  name: string;
  qty?: number;
  unit?: string;
  est?: Macros;
  food_id?: string;
}

/** The Food fields a promoted item determines. Identity (name/brand/source) is the caller's. */
export interface PromotedShape {
  base_unit: FoodBaseUnit;
  macros_per_base: FoodNutrients;
  servings: FoodServing[];
  default_serving: number;
}

/**
 * Units we can honestly convert to a base amount. Only the unambiguous ones: `oz` is fluid ounces
 * on a latte and weight ounces on a steak, and `cup`/`tbsp` are volumes that mean a different mass
 * for every food — guessing any of them would invent a number. Those fall through to the named-
 * unit branch below, where the portion is still exact; it simply is not expressed in grams.
 */
const PER_GRAM: Record<string, number> = { g: 1, gm: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000 };
const PER_ML: Record<string, number> = {
  ml: 1,
  milliliter: 1,
  millilitre: 1,
  milliliters: 1,
  millilitres: 1,
  l: 1000,
  liter: 1000,
  litre: 1000,
  liters: 1000,
  litres: 1000,
  cl: 10,
  dl: 100,
};

/** Trim trailing zeros so a serving reads "150 g", not "150.00 g". */
function fmtAmount(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Drop `source` — that belongs to a log's estimate, not to a food's per-base nutrients. */
function toNutrients(est: Macros): FoodNutrients {
  const { source: _source, ...rest } = est;
  return rest;
}

/** A name worth remembering: real words, not "food" or a stray character. */
export function promotableName(raw: string | undefined): string | null {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (name.length < 2) return null;
  if (!/[a-z]/i.test(name)) return null;
  return name;
}

/**
 * Is this item worth remembering as a Food?
 *
 * Conservative on purpose. An item with no calories is not a food someone will re-log — it is a
 * word the parser could not price, and saving it would put a row with no numbers into a list whose
 * whole promise is that a one-tap ＋ shows what it adds. An item that already carries a `food_id`
 * came from a saved food or a recipe and is somebody else's job.
 */
export function isPromotable(item: LoggedItem): boolean {
  if (item.food_id) return false;
  if (!promotableName(item.name)) return false;
  const kcal = item.est?.kcal;
  return typeof kcal === 'number' && Number.isFinite(kcal) && kcal > 0;
}

/**
 * Shape the Food this item would become.
 *
 * **The serving IS the portion they logged**, and `macros_per_base` stays per single unit (or per
 * 100 g/ml), so `macrosForLog(food)` with the default serving and quantity 1 reproduces exactly
 * what was eaten — which is what makes "I had a second latte" one tap with no re-parsing and no
 * new numbers. Scaling to any other amount stays linear and correct because the base is per-unit.
 *
 * A free-text quantity like `unit: "venti"` is not a serving the food model knows, and it is not
 * discarded: it becomes a named serving of one item ("venti"), with the macros the user accepted
 * attached to it. What IS dropped is any claim about its mass — a venti has no honest gram weight
 * here, so the food is `base_unit: 'item'` rather than a guessed conversion.
 */
export function shapeFromItem(item: LoggedItem): PromotedShape | null {
  const est = item.est;
  if (!est || !isPromotable(item)) return null;
  const qty = typeof item.qty === 'number' && Number.isFinite(item.qty) && item.qty > 0 ? item.qty : 1;
  const unit = (item.unit ?? '').trim().toLowerCase().replace(/\.$/, '');
  const nutrients = toNutrients(est);

  const perGram = PER_GRAM[unit];
  const perMl = perGram ? undefined : PER_ML[unit];
  if (perGram || perMl) {
    const base: FoodBaseUnit = perGram ? 'g' : 'ml';
    const amount = qty * (perGram ?? perMl ?? 1);
    if (!(amount > 0)) return null;
    return {
      base_unit: base,
      macros_per_base: scaleNutrients(nutrients, 100 / amount),
      servings: [{ label: `${fmtAmount(amount)} ${base}`, unit: base, amount_g: amount }],
      default_serving: 0,
    };
  }

  // Named unit ("venti", "bowl", "slice") or none at all: one item is one of whatever they said.
  const label = unit
    ? qty === 1
      ? unit
      : `${fmtAmount(qty)} ${unit}`
    : qty === 1
      ? '1 serving'
      : `${fmtAmount(qty)} servings`;
  return {
    base_unit: 'item',
    macros_per_base: scaleNutrients(nutrients, 1 / qty),
    servings: [{ label, unit: unit || 'serving', amount_g: qty }],
    default_serving: 0,
  };
}

/**
 * How alike two food names must be before they are treated as the same food.
 *
 * 0.82 is `lexicalMatchScore`'s "every token of one appears in the other" rung, so plural and
 * casing drift ("Greek yogurt" / "greek yogurts") merges, while a name that is merely CONTAINED in
 * another ("latte" inside "Starbucks latte", which scores 0.78 one way and 0.55 back) does not.
 */
export const MATCH_MIN_SCORE = 0.82;

/** Brand + name as one string — how a person says it, and how the match has to read it. */
function fullLabel(f: Pick<Food, 'name' | 'brand'>): string {
  return f.brand ? `${f.brand} ${f.name}` : f.name;
}

/**
 * The numbers inside a name, sorted — "2% milk" → `2`.
 *
 * `lexicalMatchScore` tokenises for QUANTITY inference, so it drops bare numerals: "3 eggs" and
 * "eggs" should rank as the same food, and they do. But a numeral inside a food's NAME is often
 * the thing that distinguishes it — 1% from 2% milk, Coke from Coke Zero 330 — and those scored an
 * identical 0.82 in both directions and merged. So the numbers have to agree before a merge.
 */
function numerals(text: string): string {
  return (normalizeResolveText(text).match(/\d+(?:\.\d+)?/g) ?? []).sort().join(',');
}

/**
 * Find the food this item already is, among the ones the user owns.
 *
 * The score is **symmetric** — the item measured against the food AND the food back against the
 * item, taking the lower. A one-way score merges anything that is a substring of something else,
 * which is how "latte" would silently start bumping (and re-logging at) the 250-kcal Starbucks
 * one. Requiring both directions to agree means a merge only happens when the two names really
 * describe the same thing.
 *
 * Matching is against the user's OWN foods only. A shared USDA/OFF row may well be "the same"
 * banana, but attaching to it would swap the numbers the user accepted for someone else's — and
 * silently changing a confirmed estimate is exactly what confirm-first forbids.
 */
export function matchOwnFood(name: string, foods: readonly Food[]): Food | null {
  const q = normalizeResolveText(name);
  if (!q) return null;
  const qNumerals = numerals(name);
  let best: Food | null = null;
  let bestScore = 0;
  for (const food of foods) {
    const label = fullLabel(food);
    if (numerals(label) !== qNumerals) continue;
    const forward = lexicalMatchScore(q, food);
    if (forward < MATCH_MIN_SCORE) continue;
    const backward = lexicalMatchScore(label, { name, brand: null });
    const score = Math.min(forward, backward);
    if (score >= MATCH_MIN_SCORE && score > bestScore) {
      best = food;
      bestScore = score;
    }
  }
  return best;
}
