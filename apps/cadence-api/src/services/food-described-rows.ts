/**
 * The rows of a described meal — what the memory and the food-check's items become on the card
 * (docs/cadence/FOOD-LOGGING-COACH-LED.md). food-described-meal.ts runs the steps; this file
 * turns each step's answer into rows, so each rule here has a test of its own through the
 * `DescribedMealDeps` seam.
 *
 * The rules the card relies on:
 *   - A remembered part is priced from the remembered food. The amount they say this time wins
 *     when the store can read it; a bare count ("2 eggs") takes the remembered unit; an amount
 *     the store cannot read ("a handful") falls back to the remembered amount. The memory never
 *     skips a part it holds — a skip costs a model call tomorrow for words confirmed today.
 *   - A pick is priced by the store from the record and the measure the model named; the model
 *     never writes a calorie. An estimate is labelled as the coach's and counted as such.
 *   - A row with an open question carries NO number, NO food link and NO `said`. The question is
 *     what it waits for: the card asks it, nothing counts until it is answered, and on confirm the
 *     row re-matches by name like any row without a food — so a tentative pick is never logged,
 *     and with no words on the row the phrase memory has nothing to learn from it.
 */
import type { DescribedBasis, Food, MealItem, MealKind } from '@cadence/shared';
import type { FoodPhraseRow } from '../repos/food-phrases.ts';
import {
  checkPick,
  stripAmount,
  type BookLookupFn,
  type CandidateBook,
  type MealPartLookup,
} from './food-candidate-book.ts';
import type { FoodCheckOutcome, FoodCheckVars } from './food-check.ts';
import { phraseKey } from './food-phrases.ts';
import { portionForPick } from './food-pick-portion.ts';
import { priceFood } from './food-pricing-portion.ts';
import type { ParsedMealResult } from './nutrition-parse.ts';
import { parseMeasure } from './portion-measure.ts';

export type { DescribedBasis };

export interface DescribedMealItem extends MealItem {
  /** Their own words for this part, amount included. The confirm learns from it. */
  said?: string;
  basis?: DescribedBasis;
  /** "your saved food", "USDA", "the coach's estimate" — so an estimate never looks like a lookup. */
  source_label?: string;
  assumption?: string;
  /** The one question she would ask. A row with one carries no number and no link until answered. */
  question?: string;
  /** Why this row could not be counted from a record, when it could not. */
  problem?: string;
}

export interface DescribedMealDeps {
  lookup: BookLookupFn;
  call: (vars: FoodCheckVars) => Promise<string>;
  foods: (ids: string[]) => Promise<Food[]>;
  recall: (keys: string[]) => Promise<Map<string, FoodPhraseRow>>;
  fallback: (text: string, meal?: MealKind) => Promise<ParsedMealResult & { raw_text: string }>;
  log: (entry: { input: unknown; output: unknown; meta: unknown }) => void;
}

export const NAME_MAX = 80;

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

/**
 * The amount they said this time, as a portion the store can try. A weight or a volume carries
 * its unit; a counted thing carries its noun ("a handful" → 1 handful); a bare count ("2") carries
 * no unit, so the caller fills in the remembered one. Null when there is no amount in it.
 */
export function saidPortion(measure: string): { qty: number; unit?: string } | null {
  const m = parseMeasure(measure);
  if (!(m.qty > 0)) return null;
  if (m.kind === 'mass' || m.kind === 'volume') return { qty: m.qty, unit: m.unit };
  return m.countOf ? { qty: m.qty, unit: m.countOf } : { qty: m.qty };
}

/**
 * Step 1: rows priced from the phrase memory, by part index. The portions tried, in order: the
 * amount they said (a bare count in the remembered unit), then the remembered amount. The first
 * the store can price wins, so a remembered part is never skipped for an amount word the store
 * does not know.
 */
export async function rememberedRows(
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
    const remembered = { qty: row.qty, ...(row.unit ? { unit: row.unit } : {}) };
    const said = l.measure ? saidPortion(l.measure) : null;
    const tries = said
      ? [said.unit ? said : { ...said, ...(row.unit ? { unit: row.unit } : {}) }, remembered]
      : [remembered];
    for (const portion of tries) {
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
      break;
    }
  }
  return out;
}

/** Step 4: the model's items as rows, each priced by the store or labelled for what it is. */
export async function rowsFromOutcome(
  outcome: FoodCheckOutcome,
  book: CandidateBook,
  userId: string,
  deps: DescribedMealDeps,
): Promise<DescribedMealItem[]> {
  const picks = outcome.items.map((item, i) =>
    item.pick && !outcome.problems.has(i) && !item.question
      ? checkPick({ pick: item.pick, measure: item.measure, count: item.count }, book)
      : null,
  );
  const ids = picks.flatMap((p) => (p?.ok && p.entry.food_id ? [p.entry.food_id] : []));
  const foods = new Map((ids.length ? await deps.foods(ids) : []).map((f) => [f.food_id, f]));

  return outcome.items.map((item, i): DescribedMealItem => {
    const said = item.said || '';
    const assumption = item.assumption ? { assumption: item.assumption } : {};
    // The question is the answer this row waits for: no number, no link, no `said` to teach
    // from, their own words as the name (never the record the model leaned towards), so a chip
    // answers the amount and the confirm re-matches by name. Nothing tentative is logged or learned.
    if (item.question) {
      return {
        name: (item.name ?? stripAmount(said).q ?? said).slice(0, NAME_MAX) || 'something',
        ...(item.brand ? { brand: item.brand } : {}),
        basis: 'none',
        question: item.question,
        ...assumption,
      };
    }
    const extras = { said, ...assumption };

    let problem = outcome.problems.get(i) ?? null;
    const pick = picks[i];
    if (pick?.ok) {
      const food = foods.get(pick.entry.food_id ?? '');
      const portion = food ? portionForPick(food, pick.measure, pick.count) : null;
      if (food && portion) {
        return {
          name: food.name.slice(0, NAME_MAX),
          ...(food.brand ? { brand: food.brand } : {}),
          qty: portion.qty,
          unit: portion.unit,
          est: { ...portion.est, source: 'ledger' },
          food_id: food.food_id,
          basis: 'record',
          source_label: sourceLabel(food, userId),
          ...extras,
        };
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
        qty: 1,
        unit: 'serving',
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
