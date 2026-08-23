import { micronutrientTargets } from '@cadence/shared';
import type { MealMacros } from '../../lib/api.ts';

/**
 * What one logged food contributed — the view model for brief 05.
 *
 * Deliberately NOT the day's floors-and-ceilings machinery. That view exists to answer "am I short
 * of anything?", which is a question about a whole day; asking it of a single food would draw one
 * item as 8% of an iron target and read as a deficiency it cannot possibly be. Here the honest
 * answer is a plain amount: this is what this food put into your day.
 *
 * Sodium keeps its label as the one that runs the other way, because saying nothing would leave it
 * looking like the seven floors around it — and in the incident this surface was built for, sodium
 * was the number that went wrong.
 */
export interface ItemNutrient {
  key: string;
  label: string;
  text: string;
  /** Sodium, and only ever sodium — the one to stay under rather than reach. */
  ceiling: boolean;
}

const MACROS: Array<{ key: keyof MealMacros; label: string; unit: string }> = [
  { key: 'kcal', label: 'Calories', unit: '' },
  { key: 'protein_g', label: 'Protein', unit: 'g' },
  { key: 'carbs_g', label: 'Carbs', unit: 'g' },
  { key: 'fat_g', label: 'Fat', unit: 'g' },
  { key: 'fiber_g', label: 'Fibre', unit: 'g' },
];

function amount(n: number, unit: string): string {
  const rounded = n >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return unit ? `${rounded.toLocaleString('en-US')} ${unit}` : rounded.toLocaleString('en-US');
}

/** Macros first, then whichever micros this food actually carries. Absent keys are simply absent. */
export function itemNutrients(macros: MealMacros | null): ItemNutrient[] {
  if (!macros) return [];
  const out: ItemNutrient[] = [];

  for (const m of MACROS) {
    const v = macros[m.key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out.push({ key: m.key, label: m.label, text: amount(v, m.unit), ceiling: false });
    }
  }

  for (const t of micronutrientTargets({})) {
    const v = macros[t.key as keyof MealMacros];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    // Already covered above under a warmer name — fibre is both a macro and a tracked floor.
    if (out.some((o) => o.key === t.key)) continue;
    out.push({
      key: String(t.key),
      label: t.label,
      text: amount(v, t.unit),
      ceiling: t.direction === 'ceiling',
    });
  }

  return out;
}

/**
 * Why a food might have no numbers — said plainly, because the blank is ours and not the food's.
 *
 * Never phrased as a failure of the meal or a gap in their day. It is a statement about what we
 * hold, and it comes with the one thing that fixes it.
 */
export const NO_NUMBERS =
  'I don’t hold nutrition for this one yet — renaming it to something I can look up usually finds it.';
