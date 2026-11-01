/**
 * Scoring for the food-check eval — pure, no DB, no model. What decides a verdict lives here so
 * it can be table-tested (owner, 2026-09-01: every router ships with its positives AND near-misses).
 *
 * The model chooses; code counts. A pick is `{ pick: "c3", measure, count }`: the record must be
 * one this meal's lookups returned, the measure must be one that record offers, and the totals are
 * worked out here from the record's own per-gram numbers. A labelled estimate is the one place the
 * model's own numbers are accepted, and it is counted as such.
 */
import type { FoodCheckCase } from './eval-food-check-cases.ts';

export interface ShownCandidate {
  id: string;
  name: string;
  /** Per gram, from the record's own stated measure. */
  per_g: { kcal: number | null; protein_g: number | null };
  measures: Array<{ label: string; grams: number }>;
}

export interface FinalItem {
  said?: string;
  pick?: string | null;
  measure?: string | null;
  count?: number | null;
  /** Null numbers are what the strict schema's "did not estimate this" looks like; neither counts. */
  estimate?: { kcal?: number | null; protein_g?: number | null } | null;
  assumption?: string | null;
  question?: string | null;
}

export interface ItemOutcome {
  said: string;
  kcal: number | null;
  protein_g: number | null;
  /** 'record' = priced from a returned record; 'estimate' = the model's labelled guess. */
  basis: 'record' | 'estimate' | 'none';
  /** Why this row could not be counted from a record, when it could not. */
  problem: string | null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
/**
 * "1 medium (118g)" → "1 medium": source labels carry their grams in brackets; a model drops them.
 * "1 medium = 118.0 g" → "1 medium": a model copies the "= grams" the book prints after a label.
 */
const bare = (s: string) => norm(s.replace(/\([^)]*\)/g, '').replace(/\s*=\s*[\d.]+\s*g\b.*$/i, ''));

/**
 * The record's measure the model meant: exact, then ignoring bracketed asides, then the ONE label
 * that starts with what it wrote. Ambiguous or absent is no match — never a guess.
 */
export function matchMeasure<M extends { label: string }>(measures: M[], wanted: string): M | null {
  const want = norm(wanted);
  if (!want) return null;
  const exact = measures.find((m) => norm(m.label) === want);
  if (exact) return exact;
  const byBare = measures.filter((m) => bare(m.label) === bare(want));
  if (byBare.length === 1) return byBare[0]!;
  const prefixed = measures.filter((m) => norm(m.label).startsWith(want));
  return prefixed.length === 1 ? prefixed[0]! : null;
}

/** Price one final item against what was shown. Never trusts an id or a measure it did not offer. */
export function priceItem(item: FinalItem, shown: Map<string, ShownCandidate>): ItemOutcome {
  const said = item.said ?? '';
  const asEstimate = (problem: string | null): ItemOutcome => {
    const e = item.estimate;
    if (e && (typeof e.kcal === 'number' || typeof e.protein_g === 'number')) {
      return { said, kcal: e.kcal ?? null, protein_g: e.protein_g ?? null, basis: 'estimate', problem };
    }
    return { said, kcal: null, protein_g: null, basis: 'none', problem: problem ?? 'no pick and no estimate' };
  };

  if (!item.pick) return asEstimate(null);
  const c = shown.get(item.pick);
  if (!c) return { ...asEstimate(`made-up id ${item.pick}`), basis: 'none', kcal: null, protein_g: null };

  const count = typeof item.count === 'number' && item.count > 0 ? item.count : 1;
  const want = norm(item.measure ?? '');
  const m =
    want === 'g' || want === 'gram' || want === 'grams' ? { label: 'g', grams: 1 } : matchMeasure(c.measures, want);
  if (!m) return asEstimate(`measure "${item.measure ?? ''}" is not one ${item.pick} offers`);

  const grams = m.grams * count;
  return {
    said,
    kcal: c.per_g.kcal === null ? null : c.per_g.kcal * grams,
    protein_g: c.per_g.protein_g === null ? null : c.per_g.protein_g * grams,
    basis: 'record',
    problem: null,
  };
}

/** Within tolerance: relative when the tolerance is ≤ 1, absolute units when it is above 1. */
export function within(got: number | null, want: number, tol: number): boolean {
  if (got === null) return false;
  if (tol > 1) return Math.abs(got - want) <= tol;
  return Math.abs(got - want) <= Math.max(want * tol, 0.5);
}

export interface MealScore {
  kcal: number;
  protein_g: number;
  kcalOk: boolean;
  proteinOk: boolean;
  /** Both totals in tolerance. */
  right: boolean;
  madeUpIds: number;
  estimates: number;
  /** Of the case's `flag` words, how many drew a question or a stated assumption. */
  flagged: number;
  flagsWanted: number;
}

export function scoreMeal(c: FoodCheckCase, items: FinalItem[], outcomes: ItemOutcome[]): MealScore {
  const kcal = outcomes.reduce((s, o) => s + (o.kcal ?? 0), 0);
  const protein_g = outcomes.reduce((s, o) => s + (o.protein_g ?? 0), 0);
  const kcalOk = within(kcal, c.kcal, c.kcalTol ?? 0.2);
  const proteinOk = within(protein_g, c.protein_g, c.proteinTol ?? 0.25);
  const notes = items
    .filter((i) => (i.question ?? '').trim() || (i.assumption ?? '').trim())
    .map((i) => norm(`${i.said ?? ''} ${i.question ?? ''} ${i.assumption ?? ''}`));
  const wanted = c.flag ?? [];
  const flagged = wanted.filter((w) => notes.some((n) => n.includes(norm(w)))).length;
  return {
    kcal: Math.round(kcal),
    protein_g: Math.round(protein_g * 10) / 10,
    kcalOk,
    proteinOk,
    right: kcalOk && proteinOk,
    madeUpIds: outcomes.filter((o) => o.problem?.startsWith('made-up id')).length,
    estimates: outcomes.filter((o) => o.basis === 'estimate').length,
    flagged: Math.min(flagged, wanted.length ? 1 : 0),
    flagsWanted: wanted.length ? 1 : 0,
  };
}
