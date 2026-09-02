/**
 * Wording helpers the bracket surfaces share. The canvas writes small counts as words
 * ("Group these four", "Four things, one after another") and numbers as plain digits with
 * en-US grouping ("348", "1,152") — these keep every surface saying it the same way.
 */
import type { Macros } from '@cadence/shared';

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
] as const;

/** "four" for 4; digits past twelve, where a word would read slower than the number. */
export function numberWord(n: number): string {
  return WORDS[n] ?? String(n);
}

/** "Four" — for the head of a sentence. */
export function numberWordCap(n: number): string {
  const w = numberWord(n);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** Rounded, grouped kcal figure ("348", "1,152"). A dash where we hold no number, never a zero. */
export function fmtKcal(v: number | undefined): string {
  return typeof v === 'number' ? Math.round(v).toLocaleString('en-US') : '—';
}

/** The compact macro line the canvas draws everywhere: "47P 22C 9F". Missing macros are skipped. */
export function macroLine(est: Macros | undefined): string {
  if (!est) return '';
  const parts: string[] = [];
  if (typeof est.protein_g === 'number') parts.push(`${Math.round(est.protein_g)}P`);
  if (typeof est.carbs_g === 'number') parts.push(`${Math.round(est.carbs_g)}C`);
  if (typeof est.fat_g === 'number') parts.push(`${Math.round(est.fat_g)}F`);
  return parts.join(' ');
}
