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
import { findFatSecretMatch, isFatSecretRowFresh, refreshFatSecretFood } from './food-sources/fatsecret-enrich.ts';
import { priceFood, nutrientsPerBase, type PortionInput } from './food-pricing-portion.ts';
import { lexicalMatchScore, type RankedFood } from './food-resolver-rank.ts';
import { loadResolveShared, rankedFoodsFor, type ResolveShared } from './food-resolver.ts';
import { PRESELECT_SCORE_MARGIN } from './food-resolver-types.ts';
import { MACRO_KEYS } from './nutrition-day.ts';
import { foodIsGoodEnough } from './food-sources/completeness.ts';
import { shouldResearchItem, type ResearchedFood } from './food-research.ts';

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
  /**
   * Indexes of items that named a vendor and matched nothing — what `meal-enrich.ts` will look up
   * in the background once the meal is safely on the day. Empty for a preview that pinned nothing.
   */
  wants_research: number[];
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

/**
 * An existing own-food that is the same food under another name — reuse beats a duplicate row.
 *
 * Exported for `meal-enrich.ts` (MP37): the same duplicate-pin incident this guards against here —
 * completeness-gated pinning once sent the same words to a different food on every later log — is
 * exactly what a naive "insert the researched food" step would reopen for an item that already had
 * an owned row. One dedup check, one place it is tested, both callers use it.
 */
export async function findOwnDuplicate(userId: string, name: string, brand: string | null): Promise<Food | null> {
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
async function pinItem(
  userId: string,
  item: PriceableItem,
  confidence: number | null,
  researched?: ResearchedFood | null,
): Promise<Food | null> {
  const brand = item.brand?.trim() || null;

  // A researched food pins with its REAL shape — the label's own serving and per-100 basis —
  // rather than arithmetic reconstructed from one portion. Same numbers, better row.
  if (researched) {
    const r = researched.food;
    return insertFood(userId, {
      name: r.name,
      brand: r.brand ?? brand,
      source: 'research',
      visibility: 'private',
      confidence: r.confidence,
      base_unit: r.base_unit,
      macros_per_base: r.macros_per_base ?? {},
      servings: r.servings,
      default_serving: r.default_serving,
    });
  }

  if (item.est && Object.keys(item.est).length > 0) {
    const shape = nutrientsPerBase(item.est, portionOf(item));
    if (shape) {
      return insertFood(userId, {
        name: item.name,
        brand,
        // The marker on a card that came back from preview: those numbers were researched, and
        // the row should say so even though the transient shape did not survive the round trip.
        source: item.est.source === 'research' ? 'research' : 'llm',
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
  /** A vendor-named item nothing deterministic matched — worth a grounded lookup, LATER. */
  wants_research?: boolean;
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
    const ranked = await rankedFoodsFor(userId, query, shared, item.brand);
    food = acceptMatch(userId, ranked, shared.profile)?.food ?? null;
  } catch (e) {
    console.warn('[food-pricing] resolve failed — leaving the item as parsed:', e);
    return { item: bare, priced: false, food_id: null };
  }

  /**
   * The last deterministic rung (SPEC-fatsecret.md). It costs a call every time it prices — their
   * terms make the numbers 24-hour data — so it is only ever reached when the free rungs failed.
   *
   * "Failed" now means TWO things, where it used to mean one. A rung that found nothing has always
   * fallen through; a rung that found something UNUSABLE now does too. The waterfall was gated
   * purely on whether a name matched, so a USDA row carrying calories and nothing else was accepted
   * and priced, and the source that might have completed it was never asked.
   *
   * The bar is calories plus the four macros — the owner's own line, that people are "okay with
   * just macros" in most cases. It is emphatically NOT micronutrients: paying a billed call to
   * chase the zinc content of an Oreo would spend a real rung on the half we cannot verify, for a
   * food whose label was never going to say, and then pin the answer forever. See `completeness.ts`.
   */
  if (!foodIsGoodEnough(food)) {
    if (food) {
      console.info(`[food-pricing] "${food.name}" has no usable macros — trying the next source`);
    }
    food = (await findFatSecretMatch(item.name, item.brand)) ?? food;
  }

  /**
   * A matched FatSecret row may have gone stale since the resolver put it in the pool, so it is
   * re-read before it prices anything. A refresh that fails yields no food rather than a number we
   * are no longer allowed to hold — the item falls through and keeps the parse's own estimate.
   */
  if (food && !isFatSecretRowFresh(food)) {
    food = await refreshFatSecretFood(food.fatsecret_id ?? '');
  }

  /**
   * The web-grounded rung is NOT run here — pricing only reports that this item wants it.
   *
   * Owner's ruling (2026-08-23): *"we don't have to show that slowness to the user. We can just
   * show 'logged' and input the information in the background — updating the user's UI / macros
   * whenever we get the update back."* A grounded lookup is 8-15 seconds and occasionally much
   * more, and nothing about it needs to happen while a person is standing there. So the meal
   * lands immediately with the parse's own estimate, and `meal-enrich.ts` improves it afterwards.
   *
   * My worry that this breaks confirm-first was overstated, and the distinction matters: the user
   * confirms WHAT they ate. Sharpening the numbers for a food they already named is not a change
   * to what was logged — it is the brand promise (never make them repeat themselves) doing its job
   * quietly.
   *
   * THINNESS EARNS THE TRIP TOO, NOT JUST ABSENCE (MP37). This used to read `!food` alone, so a
   * food that MATCHED but carried only calories — the exact shape `foodIsGoodEnough` already calls
   * "not good enough" two paragraphs up, for the identical reason — sailed past this line forever:
   * FatSecret had already been tried and had nothing better, and nothing downstream of here ever
   * asks the completeness question again. The vendor-named item that pinned a stub row was pinned
   * on it for good, because a present-but-thin `food` made `!food` false and the web rung never
   * saw it. The bar is the SAME one `completeness.ts` already tested and already uses just above —
   * not a stricter one invented here — so a `partial` row (the Greek yogurt case: kcal + protein +
   * calcium) still counts as good enough and stays cheap; only a stub, kcal and nothing else, or no
   * food at all, is worth the trip. `foodIsGoodEnough(null)` is already false, so this single check
   * subsumes the old `!food` test rather than adding a second condition beside it.
   */
  const wants_research = !foodIsGoodEnough(food) && shouldResearchItem(item);

  /**
   * Pinning is for when there is NO food, never for when the one we have is thin.
   *
   * Gating this on completeness looked consistent and broke the ledger's central promise: a pinned
   * row carrying only calories would fail the check on every later log, pin a SECOND row, and the
   * same words would resolve to a different food each time — which is precisely the drift the pin
   * exists to eliminate. Two DB tests caught it immediately ("resolves a later log of the same
   * vendor item to the row it already pinned" got a new id).
   *
   * So completeness escalates through SOURCES, and stops at the ledger. Consistency outranks
   * completeness once a food is ours: a thin row we reuse forever beats a fuller row we re-guess.
   * `wants_research` above must stay independent of this gate for exactly that reason — it is
   * computed from the PRE-pin `food`, so pinning a thin estimate here never suppresses the flag a
   * vendor-named item already earned.
   */
  if (!food && pin) {
    try {
      food = await pinItem(userId, item, confidence);
    } catch (e) {
      // A pin that fails costs consistency, never the meal: the parse's own numbers stand. Any
      // incomplete match we already had keeps its id, so the item stays linked to a real row.
      console.warn('[food-pricing] pin failed — keeping the parsed estimate:', e);
      return { item: bare, priced: false, food_id: food?.food_id ?? null };
    }
  }
  if (!food) return { item: bare, priced: false, food_id: null, wants_research };

  const est = priceFood(food, portion);
  // `wants_research` is threaded through every return from here on, not just the `!food` branch —
  // a thin MATCHED food used to lose the flag right here, because these two returns simply never
  // carried it. Fixing the predicate above and not this would have kept the trap fully intact.
  if (Object.keys(est).length === 0) return { item: bare, priced: false, food_id: food.food_id, wants_research };
  return {
    item: { ...bare, est, food_id: food.food_id },
    priced: true,
    food_id: food.food_id,
    wants_research,
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
  if (list.length === 0)
    return { items: [], macros: null, priced_count: 0, item_count: 0, fully_priced: false, wants_research: [] };

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
      wants_research: [],
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
    // Always the item sum, priced or not: it is the most complete total available here, and the
    // caller decides whether to prefer it (see priceParsedMeal's under-counting guard).
    macros: sumItemNutrients(outItems),
    priced_count: priced.length,
    item_count: list.length,
    fully_priced: priced.length === list.length,
    wants_research: results.flatMap((r, i) => (r.wants_research ? [i] : [])),
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
): Promise<{
  items: NutritionLog['items'];
  macros: Macros | null;
  fully_priced: boolean;
  wants_research: number[];
}> {
  if (!parsed.items.length)
    return { items: parsed.items, macros: parsed.macros, fully_priced: false, wants_research: [] };

  const out = await priceMealItems(userId, parsed.items, {
    confidence: parsed.confidence,
    pin: opts.pin,
    slot: opts.slot,
  });

  /**
   * The item sum wins whenever every item carries numbers — even when NOTHING was ledger-priced.
   *
   * A meal-level total is only ever as complete as whoever built it, and the browser's confirm card
   * built one from four keys until 2026-08-22, dropping all eight micronutrients on the way back.
   * The items had them; the total did not; the day summed the total. Recomputing here fixes that
   * for any client, which matters because the web and the API ship separately — an old app on
   * someone's phone gets the fix from the server rather than waiting for a rebuild.
   */
  const everyItemCounted = out.items.length > 0 && out.items.every((i) => i.est && Object.keys(i.est).length > 0);
  if (out.priced_count === 0 && !everyItemCounted) {
    return { items: out.items, macros: parsed.macros, fully_priced: false, wants_research: out.wants_research };
  }

  const macros = (everyItemCounted ? (out.macros ?? parsed.macros) : (parsed.macros ?? out.macros)) ?? null;
  const fromLedger = out.fully_priced && everyItemCounted;
  return {
    items: out.items,
    macros: macros ? { ...macros, source: fromLedger ? 'ledger' : 'ai' } : null,
    fully_priced: fromLedger,
    wants_research: out.wants_research,
  };
}
