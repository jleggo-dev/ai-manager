/**
 * Wording helpers the bracket surfaces share. The canvas writes small counts as words
 * ("Group these four", "Four things, one after another") and numbers as plain digits with
 * en-US grouping ("348", "1,152") — these keep every surface saying it the same way.
 */
import type { Macros } from '@cadence/shared';
import { macroLineProteinFirst } from '../amounts.ts';

const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
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

/**
 * The macro line every bracket surface draws: "47g protein · 22g carbs · 9g fat". Missing macros
 * are skipped. Spelled out, never "47P 22C 9F" — the canvas's shorthand went with the rule that
 * nothing in the product abbreviates a word the user has to decode (owner, 2026-09-08); the one
 * format lives in amounts.ts so a row, a footer and a card can never drift apart.
 */
export function macroLine(est: Macros | undefined): string {
  return macroLineProteinFirst(est ?? null);
}
