/**
 * A described meal, coach-led: software splits and fetches, the food-check model decides once,
 * the store prices, the person confirms (docs/cadence/FOOD-LOGGING-COACH-LED.md, owner
 * 2026-10-29). This is what POST /nutrition/meals/preview runs — the typed and spoken doors on
 * the meal screen, and the coach's own preview_meal — in four steps:
 *
 *   1. Words this person confirmed before are priced from memory (food-phrases.ts): the
 *      deterministic rung, no lookup and no call.
 *   2. Every other part goes to every source at once (food-candidate-book.ts) — the ledger,
 *      USDA, FatSecret's top rows — and the answers are one book.
 *   3. One call to the food-check model (food-check.ts) with the words, the slot and the book.
 *      It picks a record and one of its measures, states an assumption, or asks one question.
 *      At most one more call, and the second offers no lookups.
 *   4. Each pick is checked against the book and priced by the store (food-pick-portion.ts →
 *      priceFood). The model never writes a calorie: an id it was not shown counts nothing, a
 *      labelled estimate is counted as such, and a row with an open question is not counted
 *      until it is answered.
 *
 * When she cannot be reached — the provider is down, the reply is not JSON — the old waterfall
 * (`parse-meal` + code-picked match) prices the meal instead, every row labelled as an automatic
 * estimate and the card told, so a meal never vanishes because a model did.
 *
 * Nothing here writes: a preview walked away from leaves no food and no memory behind. The
 * confirm (nutrition.ts, meal-draft.ts) re-prices linked rows from their food and teaches the
 * phrase memory.
 */
import type { Food, MealItem, MealKind } from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import { getFoodsByIds } from '../repos/foods.ts';
import type { FoodPhraseRow } from '../repos/food-phrases.ts';
import { logAi } from './ai-log.ts';
import {
  CandidateBook,
  addLookups,
  checkPick,
  partsToLookups,
  type BookLookupFn,
  type MealPartLookup,
} from './food-candidate-book.ts';
import { wideLookup } from './food-candidate-sources.ts';
import { FOOD_CHECK_JOB, foodCheckRounds, type FoodCheckOutcome, type FoodCheckVars } from './food-check.ts';
import { phraseKey, recallPhrases } from './food-phrases.ts';
import { portionForPick } from './food-pick-portion.ts';
import { priceFood } from './food-pricing-portion.ts';
import { priceParsedMeal, sumItemNutrients } from './food-pricing.ts';
import { mealFlags } from './meal-flags.ts';
import { isMeal, parseMealResult, usageSlot, type ParsedMealResult } from './nutrition-parse.ts';
import { parseMeasure } from './portion-measure.ts';

/** Where a row's numbers came from. The card labels each row from this; nothing is disguised. */
export type DescribedBasis =
  /** A record the food-check picked, priced by the store. */
  | 'record'
  /** The phrase memory: words this person confirmed before. */
  | 'remembered'
  /** The model's own labelled estimate, because no record fit. */
  | 'estimate'
  /** The old waterfall, because the coach could not be reached. */
  | 'fallback'
  /** Nothing counted: an open question or a problem, named on the row. */
  | 'none';

export interface DescribedMealItem extends MealItem {
  /** Their own words for this part, amount included. The confirm learns from it. */
  said?: string;
  basis?: DescribedBasis;
  /** "your saved food", "USDA", "the coach's estimate" — so an estimate never looks like a lookup. */
  source_label?: string;
  assumption?: string;
  /** The one question she would ask. A row with one is not counted until it is answered. */
  question?: string;
  /** Why this row could not be counted from a record, when it could not. */
  problem?: string;
}

export interface DescribedMealPreview extends Omit<ParsedMealResult, 'items'> {
  items: DescribedMealItem[];
  raw_text: string;
  coach: {
    /** False when the waterfall priced the meal because she could not be reached. */
    reached: boolean;
    calls: number;
    /** What actually ran, one line per part — the trace the card shows, never canned copy. */
    checked: string[];
  };
}

export interface DescribedMealDeps {
  lookup: BookLookupFn;
  call: (vars: FoodCheckVars) => Promise<string>;
  foods: (ids: string[]) => Promise<Food[]>;
  recall: (keys: string[]) => Promise<Map<string, FoodPhraseRow>>;
  fallback: (text: string, meal?: MealKind) => Promise<ParsedMealResult & { raw_text: string }>;
  log: (entry: { input: unknown; output: unknown; meta: unknown }) => void;
}

const today = (): string => new Date().toISOString().slice(0, 10);
const NAME_MAX = 80;

/**
 * The old path, kept as the fallback: `parse-meal` reads the words and the code-picked match
 * prices them (A23 §1a). Pins nothing — the confirm does. Exported for the eval's floor.
 */
export async function previewByParseMeal(
  userId: string,
  text: string,
  mealHint?: MealKind,
): Promise<ParsedMealResult & { raw_text: string }> {
  const trimmed = text.trim().slice(0, 500);
  if (!trimmed) throw new Error('a meal needs words');
  const res = await runJobBySlug(userId, 'parse-meal', { meal_text: trimmed, meal_hint: mealHint ?? '' });
  const rawOut = res.formatted ?? res.raw ?? '';
  const shaped = parseMealResult(rawOut, mealHint && isMeal(mealHint) ? mealHint : undefined);
  const ledger = await priceParsedMeal(
    userId,
    { items: shaped.items, macros: shaped.macros, confidence: shaped.confidence },
    { pin: false, slot: usageSlot(today(), shaped.meal) },
  );
  void logAi(userId, {
    kind: 'parse_meal',
    input: { text: trimmed, meal_hint: mealHint ?? null, preview: true },
    output: { raw: rawOut.slice(0, 2000) },
    meta: {
      meal: shaped.meal,
      items: shaped.items.length,
      confidence: shaped.confidence,
      preview: true,
      ledger_priced: ledger.fully_priced,
    },
  });
  return { ...shaped, items: ledger.items, macros: ledger.macros, raw_text: trimmed };
}

export function productionDeps(userId: string): DescribedMealDeps {
  return {
    lookup: wideLookup(userId),
    call: async (vars) => {
      const res = await runJobBySlug(userId, FOOD_CHECK_JOB, { ...vars });
      return res.formatted ?? res.raw ?? '';
    },
    foods: (ids) => getFoodsByIds(userId, ids),
    recall: (keys) => recallPhrases(userId, keys),
    fallback: (text, meal) => previewByParseMeal(userId, text, meal),
    log: (entry) => void logAi(userId, { kind: 'food_check', ...entry }),
  };
}

/** Where a record's numbers came from, in the person's words. */
export function sourceLabel(food: Pick<Food, 'owner_user_id' | 'source'>, userId: string): string {
  if (food.owner_user_id === userId) return 'your saved food';
  switch (food.source) {
    case 'usda':
      return 'USDA';
    case 'cnf':
      return 'Canadian Nutrient File';
    case 'fatsecret':
      return 'FatSecret';
    case 'off':
      return 'Open Food Facts';
    case 'research':
      return 'a web lookup';
    case 'label_photo':
      return 'a photographed label';
    default:
      return 'the shared food file';
  }
}

/** The amount they said this time, as a portion the store can read; null when it cannot. */
function saidPortion(measure: string): { qty: number; unit?: string } | null {
  const m = parseMeasure(measure);
  if (!(m.qty > 0)) return null;
  if (m.kind === 'mass' || m.kind === 'volume') return { qty: m.qty, unit: m.unit };
  return m.countOf ? { qty: m.qty, unit: m.countOf } : null;
}

/** Step 1: rows priced from the phrase memory, by part index. */
async function rememberedRows(
  lookups: MealPartLookup[],
  userId: string,
  deps: DescribedMealDeps,
): Promise<Map<number, DescribedMealItem>> {
  const out = new Map<number, DescribedMealItem>();
  const keys = lookups.map((l) => phraseKey(l.said));
  const memory = await deps.recall(keys);
  if (!memory.size) return out;
  const hits = lookups.flatMap((l, i) => {
    const row = memory.get(keys[i]!);
    return row ? [{ i, l, row }] : [];
  });
  const foods = new Map((await deps.foods(hits.map((h) => h.row.food_id))).map((f) => [f.food_id, f]));
  for (const { i, l, row } of hits) {
    const food = foods.get(row.food_id);
    if (!food) continue;
    const portion = l.measure ? saidPortion(l.measure) : { qty: row.qty, unit: row.unit ?? undefined };
    if (!portion) continue;
    const est = priceFood(food, { ...portion, text: `${portion.qty} ${portion.unit ?? ''} ${food.name}`.trim() });
    if (!Object.keys(est).length) continue;
    out.set(i, {
      name: food.name.slice(0, NAME_MAX),
      ...(food.brand ? { brand: food.brand } : {}),
      qty: portion.qty,
      ...(portion.unit ? { unit: portion.unit } : {}),
      est: { ...est, source: 'ledger' },
      food_id: food.food_id,
      said: l.said,
      basis: 'remembered',
      source_label: 'what you picked last time',
    });
  }
  return out;
}

/** Step 4: the model's items as rows, each priced by the store or labelled for what it is. */
async function rowsFromOutcome(
  outcome: FoodCheckOutcome,
  book: CandidateBook,
  userId: string,
  deps: DescribedMealDeps,
): Promise<DescribedMealItem[]> {
  const picks = outcome.items.map((item, i) =>
    item.pick && !outcome.problems.has(i)
      ? checkPick({ pick: item.pick, measure: item.measure, count: item.count }, book)
      : null,
  );
  const ids = picks.flatMap((p) => (p?.ok && p.entry.food_id ? [p.entry.food_id] : []));
  const foods = new Map((ids.length ? await deps.foods(ids) : []).map((f) => [f.food_id, f]));

  return outcome.items.map((item, i): DescribedMealItem => {
    const said = item.said || '';
    const extras = {
      said,
      ...(item.assumption ? { assumption: item.assumption } : {}),
      ...(item.question ? { question: item.question } : {}),
    };
    let problem = outcome.problems.get(i) ?? null;
    const pick = picks[i];
    if (pick?.ok) {
      const food = foods.get(pick.entry.food_id ?? '');
      const portion = food ? portionForPick(food, pick.measure, pick.count) : null;
      if (food && portion) {
        const row: DescribedMealItem = {
          name: food.name.slice(0, NAME_MAX),
          ...(food.brand ? { brand: food.brand } : {}),
          est: { ...portion.est, source: 'ledger' },
          food_id: food.food_id,
          basis: 'record',
          source_label: sourceLabel(food, userId),
          ...extras,
        };
        // An open question keeps the amount off the row, so it counts nothing until answered.
        if (!item.question) {
          row.qty = portion.qty;
          row.unit = portion.unit;
        }
        return row;
      }
      problem = food
        ? `${pick.entry.id} cannot be priced in "${pick.measure.label}"`
        : `${pick.entry.id} is not a food this person can see`;
    } else if (pick && !pick.ok) {
      problem = pick.problem;
    }

    const e = item.estimate;
    if (e && (typeof e.kcal === 'number' || typeof e.protein_g === 'number')) {
      return {
        // The plain name the model gave, so the confirm pins a food and not a sentence; their
        // words stay on `said`. A brand only when they named one (the parse-meal rule, kept).
        name: (item.name ?? said).slice(0, NAME_MAX) || 'something',
        ...(item.brand ? { brand: item.brand } : {}),
        ...(item.question ? {} : { qty: 1, unit: 'serving' }),
        est: {
          ...(typeof e.kcal === 'number' ? { kcal: e.kcal } : {}),
          ...(typeof e.protein_g === 'number' ? { protein_g: e.protein_g } : {}),
          source: 'ai',
        },
        basis: 'estimate',
        source_label: "the coach's estimate",
        ...(problem ? { problem } : {}),
        ...extras,
      };
    }
    return {
      name: said.slice(0, NAME_MAX) || 'something',
      basis: 'none',
      problem: problem ?? 'no record fits and no estimate was given',
      ...extras,
    };
  });
}

const SOURCE_WORDS: Record<string, string> = { ledger: 'your foods', usda: 'USDA', fatsecret: 'FatSecret' };

/** The trace, true to what ran: one line per part from the fan-out's own report. */
export function traceLines(book: Pick<CandidateBook, 'sections'>, remembered: MealPartLookup[]): string[] {
  const lines = remembered.map((l) => `${l.q}: picked before, no lookup needed`);
  for (const s of book.sections) {
    const parts = s.checked.map((c) => {
      const who = SOURCE_WORDS[c.source] ?? c.source;
      if (c.status === 'skipped') return `${who} skipped`;
      if (c.status === 'error') return `${who} failed`;
      return c.detail ? `${who}: ${c.detail}` : who;
    });
    lines.push(`${s.lookup.q}: ${parts.join(' · ') || 'nothing checked'}`);
  }
  return lines;
}

function totals(items: DescribedMealItem[]): ParsedMealResult['macros'] {
  const sum = sumItemNutrients(items);
  if (!sum) return null;
  const fromStore = items.every((i) => i.basis === 'record' || i.basis === 'remembered');
  return { ...sum, source: fromStore ? 'ledger' : 'ai' };
}

/** The preview behind the described-meal doors. Throws only when there are no words at all. */
export async function previewDescribedMeal(
  userId: string,
  text: string,
  mealHint?: MealKind,
  deps: DescribedMealDeps = productionDeps(userId),
): Promise<DescribedMealPreview> {
  const trimmed = text.trim().slice(0, 500);
  if (!trimmed) throw new Error('a meal needs words');
  const meal: MealKind = mealHint && isMeal(mealHint) ? mealHint : 'other';
  const started = Date.now();
  const lookups = partsToLookups(trimmed);

  const remembered = await rememberedRows(lookups, userId, deps);
  const pending = lookups.filter((_, i) => !remembered.has(i));
  const rememberedLookups = lookups.filter((_, i) => remembered.has(i));
  const book = new CandidateBook();
  const base = { meal, flags: mealFlags(trimmed), confidence: null, raw_text: trimmed };

  let outcome: FoodCheckOutcome | null = null;
  let failure: string | null = null;
  if (pending.length) {
    await addLookups(book, pending, deps.lookup);
    try {
      outcome = await foodCheckRounds({ meal, said: trimmed, book }, { call: deps.call, lookup: deps.lookup });
      failure = outcome.error;
    } catch (e) {
      failure = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
  }

  const calls = outcome?.calls ?? 0;
  const checked = traceLines(book, rememberedLookups);
  const log = (reached: boolean, items: DescribedMealItem[]): void =>
    deps.log({
      input: { text: trimmed, meal_hint: mealHint ?? null },
      output: { items: outcome?.items ?? [], lookups: outcome?.lookups ?? [] },
      meta: {
        reached,
        calls,
        parts: lookups.length,
        remembered: remembered.size,
        records: book.entries.size,
        problems: outcome ? [...outcome.problems.values()] : [],
        bases: items.map((i) => i.basis),
        ms: Date.now() - started,
        ...(failure ? { failure } : {}),
      },
    });

  if (pending.length && (!outcome || failure)) {
    console.warn('[food-described-meal] the coach could not be reached — pricing by the old waterfall:', failure);
    const fb = await deps.fallback(pending.map((p) => p.said).join(', '), mealHint);
    const items: DescribedMealItem[] = [
      ...remembered.values(),
      ...fb.items.map((i) => ({ ...i, basis: 'fallback' as const, source_label: 'an automatic estimate' })),
    ];
    log(false, items);
    return {
      ...base,
      meal: fb.meal,
      flags: { ...base.flags, ...fb.flags },
      confidence: fb.confidence,
      items,
      macros: totals(items),
      coach: { reached: false, calls, checked: [...checked, 'the coach could not be reached'] },
    };
  }

  const hers = outcome ? await rowsFromOutcome(outcome, book, userId, deps) : [];
  const items = [...remembered.values(), ...hers];
  log(true, items);
  return { ...base, items, macros: totals(items), coach: { reached: true, calls, checked } };
}
