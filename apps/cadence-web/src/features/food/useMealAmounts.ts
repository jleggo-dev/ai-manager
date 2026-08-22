import { useMemo, useState } from 'react';
import type { MealMacros, MealPreview } from '../../lib/api.ts';
import { amountSource, scaleMacros, type AmountSource } from './amounts.ts';

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
  const [rows, setRows] = useState<AmountRow[]>(() =>
    preview.items.map((it) => ({
      name: it.name,
      ...(it.brand ? { brand: it.brand } : {}),
      matched: !!it.food_id,
      qty: it.qty ?? null,
      unit: it.unit,
      est: it.est,
      source: amountSource(it, preview.raw_text),
      // An unpriced item was read at "a typical portion", which is one of whatever it is.
      baseQty: it.qty && it.qty > 0 ? it.qty : 1,
    })),
  );

  const setQty = (i: number, qty: number | null, unit?: string) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, qty, ...(unit !== undefined ? { unit } : {}) } : r)));

  const setBrand = (i: number, brand: string) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, brand: brand.trim() || undefined } : r)));

  const removeRow = (i: number) => setRows((prev) => prev.filter((_, j) => j !== i));

  const asked = rows.filter((r) => r.source === 'asked' && r.qty == null).length;
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
    })),
    macros: total,
  });

  return { rows, setQty, setBrand, removeRow, asked, total, toPreview };
}
