/**
 * The amounts rule (design 05c): **an amount they said is kept; an amount they didn't is asked
 * for** — and asked as chips, not a keypad. "One thing assumed, one thing asked — never both
 * guessed."
 *
 * The data already supports this honestly, so nothing here guesses: the `parse-meal` job is
 * instructed to set `qty` ONLY when an amount was stated or is visually unambiguous, so an item
 * that comes back without one is precisely an amount nobody has given yet. The remaining question
 * is which of the amounts we DO have came from their own words — that one we can read off the
 * text they typed, and anything else Cadence supplied is labelled as hers.
 *
 * Deterministic on purpose, like `mealShape.ts` next door: a wrong call is visible on the card and
 * one tap from being fixed, so a legible rule beats a classifier.
 */
import type { MealMacros } from '../../lib/api.ts';
import { mealSegments } from './mealShape.ts';

/** Where an item's amount came from. */
export type AmountSource =
  /** Their own words carried the number — keep it, never re-ask. */
  | 'given'
  /** Cadence supplied it (countable from a photo, or a plain single thing) — show it, labelled. */
  | 'assumed'
  /** Nobody has said yet — this is the one we ask about. */
  | 'asked';

export interface ParsedItem {
  name: string;
  /** Absent OR null both mean "nobody has given this amount yet". */
  qty?: number | null;
  unit?: string;
}

/** Digits, fractions, and the number words people actually type. */
const NUMBER = /(\d+([./]\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])|\b(a|an|one|two|three|four|five|six|half|couple|few)\b/i;

/** The segment of their sentence that named this item, if one clearly did. */
function segmentFor(name: string, segments: string[]): string | null {
  const words = name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2);
  if (!words.length) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const seg of segments) {
    const low = seg.toLowerCase();
    const score = words.filter((w) => low.includes(w)).length;
    if (score > bestScore) {
      bestScore = score;
      best = seg;
    }
  }
  return bestScore > 0 ? best : null;
}

/**
 * Read one item's amount. `rawText` is what they actually typed or said — without it every amount
 * we hold reads as Cadence's, which is the honest default.
 */
export function amountSource(item: ParsedItem, rawText?: string | null): AmountSource {
  if (item.qty == null) return 'asked';
  const seg = segmentFor(item.name, mealSegments(rawText ?? ''));
  return seg && NUMBER.test(seg) ? 'given' : 'assumed';
}

/** How many amounts on this card are still open — the card's "N AMOUNTS TO SETTLE" line. */
export function countAsked(items: ParsedItem[], rawText?: string | null): number {
  return items.filter((it) => amountSource(it, rawText) === 'asked').length;
}

export interface AmountChoice {
  /** The chip's face — "1 slice", "2 slices", "40 g". */
  label: string;
  qty: number;
  unit?: string;
}

/** Portion words worth offering, by what the food plainly is. Order matters — first match wins. */
const PORTION_BY_FOOD: Array<{ test: RegExp; unit: string; grams: number }> = [
  { test: /\b(toast|bread|loaf|sourdough|rye|pizza|cake|pie|bacon)\b/i, unit: 'slice', grams: 40 },
  { test: /\b(butter|oil|honey|jam|jelly|sauce|dressing|syrup|cream|mayo|hummus)\b/i, unit: 'tbsp', grams: 15 },
  { test: /\b(coffee|tea|juice|milk|water|smoothie|soda|beer|wine|latte|kombucha)\b/i, unit: 'glass', grams: 240 },
  {
    test: /\b(rice|pasta|oats|oatmeal|cereal|granola|yogurt|yoghurt|skyr|soup|salad|beans|lentils|berries)\b/i,
    unit: 'cup',
    grams: 150,
  },
  { test: /\b(nuts|almonds|walnuts|cashews|seeds|crisps|chips|popcorn|raisins)\b/i, unit: 'handful', grams: 30 },
];

const pluralise = (unit: string, n: number): string =>
  n === 1 || !unit ? unit : unit.endsWith('h') ? `${unit}es` : `${unit}s`;

const chip = (qty: number, unit: string): AmountChoice => ({
  label: [qty, pluralise(unit, qty)].filter(Boolean).join(' ').trim() || String(qty),
  qty,
  ...(unit ? { unit } : {}),
});

/**
 * The chips for an amount nobody has given. One of its own unit, two of it, and a weight — the
 * three answers that cover almost every real reply — plus the caller's own "another amount"
 * escape, which is a field and deliberately last.
 */
export function amountChoices(item: ParsedItem): AmountChoice[] {
  const unit = item.unit?.trim() || PORTION_BY_FOOD.find((p) => p.test.test(item.name))?.unit || '';
  const grams = PORTION_BY_FOOD.find((p) => p.test.test(item.name))?.grams ?? null;
  const out: AmountChoice[] = [chip(1, unit), chip(2, unit)];
  if (grams != null && unit !== 'g') out.push({ label: `${grams} g`, qty: grams, unit: 'g' });
  return out;
}

/**
 * Scale an item's estimate when its amount changes. The parser prices what it read — a stated
 * amount, or "a typical portion" where none was given — so an answer of two slices is twice the
 * one-slice read. Proportional and plain: the number stays an estimate and never pretends to
 * become a measurement.
 */
export function scaleMacros(est: MealMacros | undefined, factor: number): MealMacros | undefined {
  if (!est || !Number.isFinite(factor) || factor === 1) return est;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(est)) out[k] = typeof v === 'number' ? Math.round(v * factor * 10) / 10 : v;
  return out as MealMacros;
}

/**
 * What share of this food's energy each macro carries (design 05d shows 13% / 72% / 15% beside the
 * grams). Computed from the macros themselves at 4/4/9 kcal per gram rather than from the kcal
 * field, so the three always add to 100 and never disagree with the ring above them. Null when
 * there is nothing to divide.
 */
export function macroEnergyShare(m: {
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
}): { protein: number; carbs: number; fat: number } | null {
  const p = (m.protein_g ?? 0) * 4;
  const c = (m.carbs_g ?? 0) * 4;
  const f = (m.fat_g ?? 0) * 9;
  const total = p + c + f;
  if (total <= 0) return null;
  return {
    protein: Math.round((p / total) * 100),
    carbs: Math.round((c / total) * 100),
    fat: Math.round((f / total) * 100),
  };
}

/** Protein-first, the way macros read everywhere in Cadence. */
export function macroLineProteinFirst(m: { protein_g?: number; carbs_g?: number; fat_g?: number } | null): string {
  if (!m) return '';
  return [
    m.protein_g != null ? `${Math.round(m.protein_g)}g protein` : '',
    m.carbs_g != null ? `${Math.round(m.carbs_g)}g carbs` : '',
    m.fat_g != null ? `${Math.round(m.fat_g)}g fat` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
