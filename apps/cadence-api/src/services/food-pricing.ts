/**
 * A23 §1a — the food ledger prices the meal; the model only says what it was.
 *
 * `parse-meal` is very good at "that was a venti latte from Starbucks" and very bad at what it
 * costs: ask it twice and you get two numbers. So the parse's ITEMS are kept and its NUMBERS are
 * replaced wherever a saved food can price them, and any item nothing can price is PINNED as a
 * private food so its estimate is made once and reused forever after. Consistency is a property
 * of the store, not of the model — bias calibrates out (A23 §3), variance never does.
 *
 * Costs nothing extra in the common case: a hit is a Postgres read, and a miss pins the estimate
 * the parse already produced. `estimate-food` runs only when the parse gave no numbers at all.
 */
import {
  assessDietarySafety,
  scaleNutrients,
  type DietaryProfile,
  type Food,
  type Macros,
  type NutritionLog,
} from '@cadence/shared';
import { insertFood, searchFoods, touchFoodUsage, type FoodUsageSlot } from '../repos/foods.ts';
import { estimateFood } from './food-capture.ts';
import { priceFood, nutrientsPerBase, type PortionInput } from './food-pricing-portion.ts';
import { lexicalMatchScore, type RankedFood } from './food-resolver-rank.ts';
import { loadResolveShared, rankedFoodsFor, type ResolveShared } from './food-resolver.ts';
import { PRESELECT_SCORE_MARGIN } from './food-resolver-types.ts';
import { MACRO_KEYS } from './nutrition-day.ts';

/**
 * A ledger price is applied without anyone tapping it, so the bar sits above the UI's preselect:
 * a partial token overlap (0.55–0.68) is a suggestion, not an identification.
 */
export const PRICING_MIN_SCORE = 0.7;

/** How close a canonical name must be to one of your own foods to be the same food. */
export const PIN_REUSE_SCORE = 0.9;

export interface PriceableItem {
  name: string;
  qty?: number;
  unit?: string;
  est?: Macros;
  food_id?: string;
  /** Vendor/brand when the parse heard one ("from Materia Prima") — A23 §1b. */
  brand?: string | null;
}

export interface PricingOutcome {
  items: NutritionLog['items'];
  macros: Macros | null;
  priced_count: number;
  item_count: number;
  /** Every item came from a food row — the meal's numbers are reproducible. */
  fully_priced: boolean;
}

function portionOf(item: PriceableItem): PortionInput {
  return { qty: item.qty, unit: item.unit, text: `${item.qty ?? ''} ${item.unit ?? ''} ${item.name}`.trim() };
}

function isSafe(food: Pick<Food, 'name' | 'brand'>, profile: DietaryProfile | null): boolean {
  return assessDietarySafety(profile, [food.name, food.brand ?? '']).safe !== false;
}

/**
 * Accept a match only when it is unambiguous. A wrong confident price is worse than no price, so
 * near-ties go unpriced — EXCEPT when exactly one of the tied rows is the user's own food, which
 * is the pinned parfait beating a stranger's row with the same name.
 */
export function acceptMatch(userId: string, ranked: RankedFood[], profile: DietaryProfile | null): RankedFood | null {
  const safe = ranked.filter((r) => isSafe(r.food, profile));
  const top = safe[0];
  if (!top || top.score < PRICING_MIN_SCORE) return null;
  const near = safe.filter((r) => top.score - r.score < PRESELECT_SCORE_MARGIN);
  if (near.length === 1) return top;
  const own = near.filter((r) => r.food.owner_user_id === userId);
  return own.length === 1 ? own[0]! : null;
}

/** Sum item estimates into the meal total, rounded exactly like every other nutrient path. */
export function sumItemNutrients(items: NutritionLog['items']): Macros | null {
  const total: Record<string, number> = {};
  for (const item of items) {
    for (const key of MACRO_KEYS) {
      const v = item.est?.[key];
      if (typeof v === 'number' && Number.isFinite(v)) total[key] = (total[key] ?? 0) + v;
    }
  }
  const rounded = scaleNutrients(total, 1);
  return Object.keys(rounded).length ? rounded : null;
}

/** An existing own-food that is the same food under another name — reuse beats a duplicate row. */
async function findOwnDuplicate(userId: string, name: string, brand: string | null): Promise<Food | null> {
  const hits = await searchFoods(userId, name, 10);
  let best: Food | null = null;
  let bestScore = 0;
  for (const food of hits) {
    if (food.owner_user_id !== userId) continue;
    const score = lexicalMatchScore(brand ? `${brand} ${name}` : name, food);
    if (score >= PIN_REUSE_SCORE && score > bestScore) {
      best = food;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Pin one unpriceable item as a private food. Prefers the estimate the parse already made (free);
 * falls back to `estimate-food` only when the parse produced no numbers for it.
 */
async function pinItem(userId: string, item: PriceableItem, confidence: number | null): Promise<Food | null> {
  const brand = item.brand?.trim() || null;

  if (item.est && Object.keys(item.est).length > 0) {
    const shape = nutrientsPerBase(item.est, portionOf(item));
    if (shape) {
      return insertFood(userId, {
        name: item.name,
        brand,
        source: 'llm',
        visibility: 'private',
        confidence,
        ...shape,
      });
    }
  }

  // No numbers to pin — ask for some, once, and keep them forever.
  const candidate = await estimateFood(userId, [brand, item.name].filter(Boolean).join(' '));
  const canonical = candidate.name.trim();
  const canonicalBrand = brand ?? candidate.brand;
  // estimate-food normalises names ("parfait thing" → "Yogurt Parfait"), so re-check for a row we
  // already own under the canonical name before minting a near-duplicate.
  if (canonical.toLowerCase() !== item.name.trim().toLowerCase()) {
    const dupe = await findOwnDuplicate(userId, canonical, canonicalBrand);
    if (dupe) return dupe;
  }
  return insertFood(userId, {
    name: canonical,
    brand: canonicalBrand,
    source: candidate.source,
    visibility: 'private',
    base_unit: candidate.base_unit,
    macros_per_base: candidate.macros_per_base,
    servings: candidate.servings,
    default_serving: candidate.default_serving,
    confidence: candidate.confidence,
  });
}

interface PricedOne {
  item: NutritionLog['items'][number];
  priced: boolean;
  food_id: string | null;
}

async function priceOne(
  userId: string,
  item: PriceableItem,
  shared: ResolveShared,
  confidence: number | null,
  pin: boolean,
): Promise<PricedOne> {
  const bare: NutritionLog['items'][number] = {
    name: item.name,
    ...(item.brand?.trim() ? { brand: item.brand.trim() } : {}),
    ...(typeof item.qty === 'number' ? { qty: item.qty } : {}),
    ...(item.unit ? { unit: item.unit } : {}),
    ...(item.est ? { est: item.est } : {}),
  };
  const portion = portionOf(item);
  const query = [item.brand?.trim(), item.name].filter(Boolean).join(' ');

  let food: Food | null = null;
  try {
    const ranked = await rankedFoodsFor(userId, query, shared);
    food = acceptMatch(userId, ranked, shared.profile)?.food ?? null;
  } catch (e) {
    console.warn('[food-pricing] resolve failed — leaving the item as parsed:', e);
    return { item: bare, priced: false, food_id: null };
  }

  if (!food && pin) {
    try {
      food = await pinItem(userId, item, confidence);
    } catch (e) {
      // A pin that fails costs consistency, never the meal: the parse's own numbers stand.
      console.warn('[food-pricing] pin failed — keeping the parsed estimate:', e);
      return { item: bare, priced: false, food_id: null };
    }
  }
  if (!food) return { item: bare, priced: false, food_id: null };

  const est = priceFood(food, portion);
  if (Object.keys(est).length === 0) return { item: bare, priced: false, food_id: food.food_id };
  return {
    item: { ...bare, est, food_id: food.food_id },
    priced: true,
    food_id: food.food_id,
  };
}

/**
 * Price a parsed meal from the ledger. Never throws and never drops an item — the worst case is
 * today's behaviour (the parse's own estimates, unpinned).
 */
export async function priceMealItems(
  userId: string,
  items: PriceableItem[],
  opts: { confidence?: number | null; pin?: boolean; slot?: FoodUsageSlot } = {},
): Promise<PricingOutcome> {
  const list = items.filter((i) => i && typeof i.name === 'string' && i.name.trim());
  if (list.length === 0) return { items: [], macros: null, priced_count: 0, item_count: 0, fully_priced: false };

  let shared: ResolveShared;
  try {
    shared = await loadResolveShared(userId, opts.slot);
  } catch (e) {
    console.warn('[food-pricing] context load failed — leaving the meal as parsed:', e);
    return {
      items: list.map(({ brand: _brand, ...rest }) => rest),
      macros: null,
      priced_count: 0,
      item_count: list.length,
      fully_priced: false,
    };
  }

  const pin = opts.pin !== false;
  const results = await Promise.all(list.map((item) => priceOne(userId, item, shared, opts.confidence ?? null, pin)));
  const priced = results.filter((r) => r.priced);

  // Teach recents/frequents from what was actually eaten — next time this ranks higher and the
  // resolve gets cheaper. Best-effort: a usage miss must never fail a log.
  await Promise.all(
    results
      .map((r) => r.food_id)
      .filter((id): id is string => !!id)
      .map((id) =>
        touchFoodUsage(userId, id, opts.slot).catch((e: unknown) =>
          console.warn('[food-pricing] usage touch failed:', e),
        ),
      ),
  );

  const outItems = results.map((r) => r.item);
  return {
    items: outItems,
    macros: priced.length > 0 ? sumItemNutrients(outItems) : null,
    priced_count: priced.length,
    item_count: list.length,
    fully_priced: priced.length === list.length,
  };
}

/**
 * The seam both parse paths call: price a shaped parse, then decide what the MEAL total is.
 *
 * The item sum replaces the model's meal-level estimate only when every item carries numbers.
 * Otherwise the parse's total stands — an item we could neither price nor pin contributes zero to
 * a sum, and quietly under-counting a meal is a worse failure than an inconsistent one.
 */
export async function priceParsedMeal(
  userId: string,
  parsed: { items: NutritionLog['items']; macros: Macros | null; confidence: number | null },
  opts: { pin?: boolean; slot?: FoodUsageSlot } = {},
): Promise<{ items: NutritionLog['items']; macros: Macros | null; fully_priced: boolean }> {
  if (!parsed.items.length) return { items: parsed.items, macros: parsed.macros, fully_priced: false };

  const out = await priceMealItems(userId, parsed.items, {
    confidence: parsed.confidence,
    pin: opts.pin,
    slot: opts.slot,
  });
  if (out.priced_count === 0) return { items: out.items, macros: parsed.macros, fully_priced: false };

  const everyItemCounted = out.items.every((i) => i.est && Object.keys(i.est).length > 0);
  const macros = (everyItemCounted ? (out.macros ?? parsed.macros) : (parsed.macros ?? out.macros)) ?? null;
  const fromLedger = out.fully_priced && everyItemCounted;
  return {
    items: out.items,
    macros: macros ? { ...macros, source: fromLedger ? 'ledger' : 'ai' } : null,
    fully_priced: fromLedger,
  };
}
