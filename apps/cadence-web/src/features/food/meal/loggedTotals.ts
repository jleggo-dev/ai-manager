/**
 * The day's totals with every still-open meal taken back out. The server's day counts an open
 * draft toward its totals (the 1b "open fork"); the owner's ruling for the meal surface
 * (2026-09-07) is the opposite — "only show what's logged" — so nothing in a cart, and nothing
 * still open, moves these numbers until it is logged.
 */
import type { Macros } from '@cadence/shared';
import type { NutritionDayData } from '../../../lib/api.ts';

const KEYS = ['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const;

/** The day's totals with every still-open meal taken back out. */
export function loggedTotals(day: NutritionDayData | null | undefined): Macros {
  const out: Macros = { ...(day?.totals ?? {}) };
  for (const m of day?.meals ?? []) {
    if (m.state !== 'open' || m.provisional) continue;
    for (const k of KEYS) {
      const v = m.macros?.[k];
      if (typeof v === 'number' && typeof out[k] === 'number') out[k] = Math.max(0, (out[k] as number) - v);
    }
  }
  return out;
}
