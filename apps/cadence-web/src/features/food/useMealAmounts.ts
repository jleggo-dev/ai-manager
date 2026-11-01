import { useMemo, useState } from 'react';
import type { MealKind, MealMacros, MealPreview } from '../../lib/api.ts';
import { amountSource, scaleMacros, type AmountSource } from './amounts.ts';
import { reReadAnswer } from './reReadAnswer.ts';

/** One row of the confirm card: the parsed item, where its amount came from, and where it is now. */
export interface AmountRow {
  name: string;
  /** Where it came from, when the parse heard it or the user answers the vendor question. */
  brand?: string;
  /** Already matched to a saved food — its price is settled and its vendor already known. */
  matched: boolean;
  /** `null` while an asked amount is still open — the card cannot log until every one is answered. */
  qty: number | null;
  unit?: string;
  est?: MealMacros;
  source: AmountSource;
  /** What the parser originally priced, so a re-answer scales from the read, not from the last answer. */
  baseQty: number;
  /** The food the coach linked the row to; rides back so the confirm prices from it, never re-matches. */
  food_id?: string;
  /** Their own words for this part; rides back so the same words next time need no call. */
  said?: string;
  assumption?: string;
  question?: string;
  /** With a question: her answers, drawn as buttons (MealQuestionChoices). Typing stays open. */
  choices?: string[];
  /** With a question: their words for the part, amount included — what the answer is re-read with. */
  asked_about?: string;
  source_label?: string;
}

/** One parsed item as a row of the card. `rawText` is what they typed, so a given amount reads as theirs. */
function rowFromItem(it: MealPreview['items'][number], rawText: string): AmountRow {
  return {
    name: it.name,
    ...(it.brand ? { brand: it.brand } : {}),
    matched: !!it.food_id,
    qty: it.qty ?? null,
    unit: it.unit,
    est: it.est,
    source: amountSource(it, rawText),
    // An unpriced item was read at "a typical portion", which is one of whatever it is.
    baseQty: it.qty && it.qty > 0 ? it.qty : 1,
    ...(it.food_id ? { food_id: it.food_id } : {}),
    ...(it.said ? { said: it.said } : {}),
    ...(it.assumption ? { assumption: it.assumption } : {}),
    ...(it.question ? { question: it.question } : {}),
    ...(it.choices?.length ? { choices: it.choices } : {}),
    ...(it.asked_about ? { asked_about: it.asked_about } : {}),
    ...(it.source_label ? { source_label: it.source_label } : {}),
  };
}

/**
 * EVERY nutrient a meal can carry, not just the four the card draws.
 *
 * This summed `kcal/protein/carbs/fat` alone until 2026-08-22, and the total it built is what the
 * confirm posts — so all eight micronutrients were dropped on the way back, every time, on the
 * main text-logging path. The model had been returning them per item all along (a logged breakfast
 * on 2026-08-22 carried 6, 3, 6, 2, 0 and 6 of them across its items) and the day summed the MEAL
 * total, which had none. Net effect: the Nutrients screen told people nothing they ate carried
 * mineral data, which was never true.
 *
 * The card still DISPLAYS four. What it hands back has to be complete.
 */
const SUMMED_KEYS = [
  'kcal',
  'protein_g',
  'carbs_g',
  'fat_g',
  'fiber_g',
  'sodium_mg',
  'iron_mg',
  'zinc_mg',
  'vitamin_c_mg',
  'calcium_mg',
  'potassium_mg',
  'vitamin_b12_ug',
] as const satisfies ReadonlyArray<keyof MealMacros>;

function sum(rows: AmountRow[]): MealMacros {
  const total: MealMacros = {};
  for (const r of rows) {
    const scaled = scaleMacros(r.est, r.qty == null ? 0 : r.qty / r.baseQty);
    for (const k of SUMMED_KEYS) {
      const v = scaled?.[k];
      if (typeof v === 'number') total[k] = (total[k] ?? 0) + v;
    }
  }
  return total;
}

/**
 * The confirm card's amount state (design 05c). Every item arrives either with an amount — kept,
 * never re-asked — or without one, and the ones without are the only questions the card asks.
 * Nothing counts until they tap, so what this returns from `toPreview()` is exactly and only what
 * gets written.
 */
export function useMealAmounts(preview: MealPreview) {
  const [rows, setRows] = useState<AmountRow[]>(() => preview.items.map((it) => rowFromItem(it, preview.raw_text)));

  const setQty = (i: number, qty: number | null, unit?: string) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, qty, ...(unit !== undefined ? { unit } : {}) } : r)));

  const setBrand = (i: number, brand: string) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, brand: brand.trim() || undefined } : r)));

  const removeRow = (i: number) => setRows((prev) => prev.filter((_, j) => j !== i));

  /**
   * Fix the name, keep every number — brief 03's central move, here BEFORE anything is written.
   *
   * "We might not have the right name but we definitely have the right nutrients." The card is the
   * last moment this is free: after the log, a name nothing matched is pinned as a permanent food
   * and the wrong one resolves again tomorrow.
   */
  const renameRow = (i: number, name: string, brand?: string | null) =>
    setRows((prev) =>
      prev.map((r, j) =>
        j !== i || !name.trim()
          ? r
          : {
              ...r,
              name: name.trim(),
              ...(brand === undefined ? {} : brand?.trim() ? { brand: brand.trim() } : { brand: undefined }),
            },
      ),
    );

  /**
   * "These are the same thing" — the repair a comma-split parse actually needs.
   *
   * Folds the nutrients, not just the row: a phantom item carries real numbers, and deleting it
   * while keeping the meal total is how 450 mg of sodium that was never eaten stays on the day.
   * The AMOUNT is not summed — two rows of one food are one portion read twice, and a doubled
   * amount hides inside a plausible number where a wrong one is visible and correctable.
   *
   * The LINK is dropped: a merged row is neither of its halves, so the kept half's `food_id`
   * would have the server re-price the sum from one food alone and lose the other's nutrients —
   * the thing the merge exists to prevent. With no food the row re-matches by name, and with no
   * `said` it teaches the phrase memory nothing.
   */
  const mergeRow = (from: number, into: number) =>
    setRows((prev) => {
      const a = prev[from];
      const b = prev[into];
      if (from === into || !a || !b) return prev;
      const est: Record<string, number> = {};
      for (const side of [b.est, a.est]) {
        for (const [k, v] of Object.entries(side ?? {})) {
          if (typeof v === 'number' && Number.isFinite(v)) est[k] = (est[k] ?? 0) + v;
        }
      }
      const merged: AmountRow = {
        ...b,
        matched: false,
        ...(b.brand || a.brand ? { brand: b.brand || a.brand } : {}),
        ...(Object.keys(est).length ? { est: est as MealMacros } : {}),
      };
      delete merged.food_id;
      delete merged.said;
      return prev.map((r, j) => (j === into ? merged : r)).filter((_, j) => j !== from);
    });

  /**
   * Her question answered — a tapped choice or a typed line (MealQuestionChoices). The part is
   * re-read with the answer as one text through the same read (reReadAnswer.ts), and the row(s)
   * that come back take the asked row's place: priced, linked, with their words, so the confirm
   * carries them like any picked row and the memory learns. False when the re-read failed or
   * came back empty — the row then stays as it was, buttons and all.
   */
  const answerRow = async (i: number, answer: string, chosen: boolean, meal?: MealKind): Promise<boolean> => {
    const row = rows[i];
    if (!row) return false;
    const p = await reReadAnswer(row, answer, chosen, meal);
    if (!p) return false;
    const fresh = p.items.map((it) => rowFromItem(it, p.raw_text));
    setRows((prev) => prev.flatMap((r, j) => (j === i ? fresh : [r])));
    return true;
  };

  const open = rows.filter((r) => r.source === 'asked' && r.qty == null);
  const asked = open.length;
  /** Of the open rows, how many wait on her question with answers to tap rather than on an amount. */
  const askedChoices = open.filter((r) => !!r.choices?.length).length;
  const total = useMemo(() => sum(rows), [rows]);

  /** The card's own contents, in the shape the log endpoint takes back verbatim. */
  const toPreview = (): MealPreview => ({
    ...preview,
    items: rows.map((r) => ({
      name: r.name,
      // Carried back deliberately: the server re-prices the confirm, and a vendor dropped here is
      // a vendor missing from the food it pins (A23 §1b).
      ...(r.brand ? { brand: r.brand } : {}),
      ...(r.qty != null ? { qty: r.qty } : {}),
      ...(r.unit ? { unit: r.unit } : {}),
      est: scaleMacros(r.est, r.qty == null ? 1 : r.qty / r.baseQty),
      // The coach's link and their words ride back too: the server prices a linked row from its
      // food, and learns the words so the same ones next time are a deterministic hit.
      ...(r.food_id ? { food_id: r.food_id } : {}),
      ...(r.said ? { said: r.said } : {}),
    })),
    macros: total,
  });

  return { rows, setQty, setBrand, removeRow, renameRow, mergeRow, answerRow, asked, askedChoices, total, toPreview };
}
