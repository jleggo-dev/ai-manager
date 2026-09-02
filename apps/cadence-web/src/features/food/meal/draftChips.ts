/**
 * Chips for a draft item whose amount nobody has given (the meal body's asked row).
 *
 * Same idiom as `amounts.ts` — chips, never a keypad — with one contract-imposed restriction:
 * the draft's amount patch carries ONLY a quantity (`PATCH …/amount {index, qty}`), so a chip
 * can never change the item's unit. Chips therefore stay in the item's own unit (or plain
 * counts when it has none); the unit-swapping "40 g" escape lives only on the pre-log card.
 */
import { amountChoices, type AmountChoice } from '../amounts.ts';
import { classifyServingUnit } from '../servingPicker.ts';
import type { Food, MealItem } from '@cadence/shared';

/**
 * Whether a full Food's servings span more than one axis (mass/volume/count) — the same rule
 * the API's `FoodSummary.ambiguous` states. The barcode door lands a whole Food, so the
 * ＋-or-sheet fork needs the answer computed client-side.
 */
export function foodNeedsAsking(food: Pick<Food, 'servings'>): boolean {
  return new Set(food.servings.map((s) => classifyServingUnit(s.unit))).size > 1;
}

export function draftAmountChips(item: MealItem): AmountChoice[] {
  const unit = item.unit?.trim();
  if (!unit) {
    return [1, 2, 3].map((qty) => ({ label: String(qty), qty }));
  }
  return amountChoices({ name: item.name, qty: null, unit }).filter((c) => c.unit === unit);
}
