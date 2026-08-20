import { macrosForLog } from '@cadence/shared';
import type { MealMacros } from '../../../lib/api.ts';
import type { PlateEntry } from './useMealCapture.ts';

/** Round to two decimals — the ±0.25 stepper's arithmetic, kept off the render path. */
export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Whole-number display for kcal and gram totals. */
export const fmtKcal = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Sum a plate's items into one macro total (client-side preview; the server recomputes on log). */
export function sumPlate(plate: PlateEntry[]): MealMacros {
  const total: MealMacros = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const e of plate) {
    const m = macrosForLog(e.food, { servingIndex: e.servingIndex, quantity: e.quantity });
    total.kcal = (total.kcal ?? 0) + (m.kcal ?? 0);
    total.protein_g = (total.protein_g ?? 0) + (m.protein_g ?? 0);
    total.carbs_g = (total.carbs_g ?? 0) + (m.carbs_g ?? 0);
    total.fat_g = (total.fat_g ?? 0) + (m.fat_g ?? 0);
  }
  return total;
}
