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
import type { MealKind } from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import { getFoodsByIds } from '../repos/foods.ts';
import { logAi } from './ai-log.ts';
import { CandidateBook, addLookups, partsToLookups, type MealPartLookup } from './food-candidate-book.ts';
import { wideLookup } from './food-candidate-sources.ts';
import { FOOD_CHECK_JOB, foodCheckRounds, type FoodCheckOutcome } from './food-check.ts';
import {
  rememberedRows,
  rowsFromOutcome,
  type DescribedMealDeps,
  type DescribedMealItem,
} from './food-described-rows.ts';
import { phraseKey, recallPhrases } from './food-phrases.ts';
import { priceParsedMeal, sumItemNutrients } from './food-pricing.ts';
import { mealFlags } from './meal-flags.ts';
import { isMeal, parseMealResult, usageSlot, type ParsedMealResult } from './nutrition-parse.ts';

export type { DescribedBasis, DescribedMealDeps, DescribedMealItem } from './food-described-rows.ts';

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

const today = (): string => new Date().toISOString().slice(0, 10);

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

/** The meal's total: every counted row. A row waiting on a question carries no number and is left out. */
function totals(items: DescribedMealItem[]): ParsedMealResult['macros'] {
  const counted = items.filter((i) => !i.question);
  const sum = sumItemNutrients(counted);
  if (!sum) return null;
  const fromStore = counted.every((i) => i.basis === 'record' || i.basis === 'remembered');
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
  const rememberedKeys = new Set(rememberedLookups.map((l) => phraseKey(l.said)));
  // The model is asked about the parts the memory did not settle, in their words for those parts
  // only: the whole meal would have it answer for a remembered part too, and that row is already
  // on the card.
  const pendingWords = pending.map((p) => p.said).join(', ');
  const book = new CandidateBook();
  const base = { meal, flags: mealFlags(trimmed), confidence: null, raw_text: trimmed };

  let outcome: FoodCheckOutcome | null = null;
  let failure: string | null = null;
  if (pending.length) {
    await addLookups(book, pending, deps.lookup);
    try {
      outcome = await foodCheckRounds({ meal, said: pendingWords, book }, { call: deps.call, lookup: deps.lookup });
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
    const fb = await deps.fallback(pendingWords, mealHint);
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
      // The card's notice says she could not be reached; the trace does not say it twice.
      coach: { reached: false, calls, checked },
    };
  }

  // A row the model wrote for a remembered part anyway (the words are hers to read, the memory's
  // row is already on the card) is dropped by its phrase key, so no part appears twice.
  const hers = (outcome ? await rowsFromOutcome(outcome, book, userId, deps) : []).filter(
    (r) => !r.said || !rememberedKeys.has(phraseKey(r.said)),
  );
  const items = [...remembered.values(), ...hers];
  log(true, items);
  return { ...base, items, macros: totals(items), coach: { reached: true, calls, checked } };
}
