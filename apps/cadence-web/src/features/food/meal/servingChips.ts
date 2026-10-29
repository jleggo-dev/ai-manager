/**
 * The amount sheet's chips (quick log 1b) — "½ cup · 1 cup · 1½ cups · 170 g · Other…".
 *
 * Only for when the default isn't right, so the chips are the answers people actually give:
 * the serving a TAP adds (the food's default) at half, one and one-and-a-half, then each other
 * serving the food names, once, in the picker's order (`orderServingIndices` — volume before
 * weight for produce, the printed weight first for brands). Labels are built from the
 * serving's own label, never a guessed unit, and a CNF-style "(170g)" tail is dropped rather
 * than scaled wrong.
 */
import type { Food } from '@cadence/shared';
import { compoundLabel, orderServingIndices } from '../servingPicker.ts';

export interface ServingChip {
  servingIndex: number;
  quantity: number;
  label: string;
}

/** The most chips drawn before "Other…" takes over. */
export const CHIP_MAX = 4;

const LEAD_MULTIPLES = [0.5, 1, 1.5] as const;

/** Nouns that take an "s" when there is more than one; everything else is left as written. */
const PLURAL = new Set([
  'cup',
  'tablespoon',
  'teaspoon',
  'slice',
  'scoop',
  'piece',
  'serving',
  'glass',
  'mug',
  'bottle',
  'can',
  'egg',
  'bar',
  'packet',
  'container',
  'bowl',
  'patty',
  'portion',
]);

const FRACTIONS: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75 };

/** "1½", "½", "2", "0.3" — the fraction glyphs people read on a packet, a decimal otherwise. */
export function fmtQuantity(n: number): string {
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 100) / 100;
  const glyph = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : null;
  if (glyph) return whole > 0 ? `${whole}${glyph}` : glyph;
  if (frac === 0) return String(whole);
  return String(Math.round(n * 10) / 10);
}

/**
 * The serving's label at a multiple: "1 cup" × 1.5 → "1½ cups"; "1 container (170g)" × 0.5 →
 * "½ container"; a label with no leading number ("cup") gets the quantity in front of it.
 */
export function scaleServingLabel(label: string, quantity: number): string {
  const m = /^(\d+(?:[.,]\d+)?|[¼½¾])\s*(.*)$/.exec(label.trim());
  if (!m) return `${fmtQuantity(quantity)} ${label.trim()}`;
  const base = FRACTIONS[m[1]!] ?? Number(m[1]!.replace(',', '.'));
  const written = (m[2] ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  const amount = Math.round(base * quantity * 100) / 100;
  if (!written) return fmtQuantity(amount);
  // "2 tablespoons" halved is "1 tablespoon"; "1 cup" halved is "½ cup" — one of a thing, or
  // less, is singular; only more than one takes the s, and only for nouns we know take one.
  const lower = written.toLowerCase();
  const singular = lower.endsWith('s') && PLURAL.has(lower.slice(0, -1)) ? written.slice(0, -1) : written;
  const noun = amount > 1 && PLURAL.has(singular.toLowerCase()) ? `${singular}s` : singular;
  return `${fmtQuantity(amount)} ${noun}`;
}

/** The chips, in the order the sheet draws them. Never more than CHIP_MAX. */
export function servingChips(
  food: Pick<Food, 'brand' | 'source' | 'name' | 'servings' | 'default_serving'>,
): ServingChip[] {
  if (!food.servings.length) return [];
  const lead = Math.max(0, Math.min(food.default_serving ?? 0, food.servings.length - 1));
  const leadServing = food.servings[lead]!;
  const chips: ServingChip[] = LEAD_MULTIPLES.map((q) => ({
    servingIndex: lead,
    quantity: q,
    label: scaleServingLabel(leadServing.label, q),
  }));
  for (const i of orderServingIndices(food).filter((i) => i !== lead)) {
    if (chips.length >= CHIP_MAX) break;
    chips.push({ servingIndex: i, quantity: 1, label: compoundLabel(food.servings[i]!, food.servings) });
  }
  return chips.slice(0, CHIP_MAX);
}

/** The chip that matches a serving + quantity exactly, for the selected state. */
export function chipMatches(chip: ServingChip, servingIndex: number, quantity: number): boolean {
  return chip.servingIndex === servingIndex && Math.abs(chip.quantity - quantity) < 0.001;
}
