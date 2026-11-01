/**
 * The candidate book: what every source said about each part of a described meal, in one place,
 * for the food-check model to read (docs/cadence/FOOD-LOGGING-COACH-LED.md, owner 2026-10-29:
 * software splits and fetches, she decides, once).
 *
 * Pure. The lookups arrive through `BookLookupFn`, so a test fakes every source and the eval
 * runs the real fan-out; nothing here reads the database or the network. The production lookup
 * (`food-candidate-sources.ts`) is the fan-out plus FatSecret's top rows — every latte, not the
 * one row a lexical score ranked first, which is how a Venti latte was logged as Matcha (#426).
 *
 * What the book holds, per record: an id of this meal's own (`c1`, `c2`…), where it came from,
 * its per-gram numbers, the measures it offers with their grams, and the guards' notes. What it
 * refuses to do: rank, drop, or pick. A record with no usable calories is marked incomplete and
 * left in — the model is told, not protected (run 2 picked a zero-kcal "Cafe Latte" once).
 *
 * The split is deliberately plain. Comma, newline, "and", "with", "+", "&" separate parts; a
 * leading amount ("150ml", "2 tbsp", "a handful of") is peeled off into the lookup's measure.
 * Dictated prose with no separators stays one part: the model may ask for one more round of
 * lookups to repair that, and the second call is its last (food-check.ts).
 */
import type { FanOutResult, SourceCheck } from './food-source-fanout.ts';
import type { FoodSourceName, MeasureOption, SourceCandidate } from './food-source-report.ts';
import type { NutritionTier } from './food-sources/completeness.ts';

/** Parts a meal can have before the rest is dropped; a person rarely names more in one go. */
export const MAX_PARTS = 10;
/** Records shown per lookup. Past this the book costs more tokens than the extra rows earn. */
export const SHOW_PER_LOOKUP = 8;

const SEPARATORS = /\s*(?:,|;|\n|\+|&|\band\b|\bwith\b|\bplus\b)\s*/i;
const AMOUNT =
  /^(?:(?:\d+(?:[./]\d+)?|\d*\.\d+|a|an|one|two|three|four|half|quarter|a few|some|a bit of|a splash of)\s*)?(?:(?:ml|l|g|kg|grams?|oz|ounces?|lbs?|cups?|c|tbsp|tablespoons?|tsp|teaspoons?|slices?|shots?|scoops?|cans?|pieces?|handful|small|medium|large)\b\s*)?(?:of\s+)?/i;
const MEASURE_WORD = /\d|cup|tbsp|tsp|oz|ml|g\b|slice|shot|scoop|handful|small|medium|large|half|quarter/i;

/** The parts of a meal, in order, as the person wrote them. Never empty for non-blank text. */
export function splitMealParts(text: string): string[] {
  const parts = text
    .split(SEPARATORS)
    .map((p) => p.replace(/^[\s.]+|[\s.]+$/g, ''))
    .filter(Boolean)
    .slice(0, MAX_PARTS);
  return parts.length ? parts : [text.trim()].filter(Boolean);
}

/** "150ml 2% milk" → { q: "2% milk", measure: "150ml" }; "a banana" → { q: "banana", measure: null }. */
export function stripAmount(part: string): { q: string; measure: string | null } {
  const m = AMOUNT.exec(part);
  const prefix = m?.[0] ?? '';
  const q = part.slice(prefix.length).trim();
  if (!q) return { q: part.trim(), measure: null };
  const measure = prefix.replace(/\bof\s*$/i, '').trim();
  return { q, measure: measure && MEASURE_WORD.test(measure) ? measure : null };
}

export interface BookLookup {
  q: string;
  measure: string | null;
  brand: string | null;
}

/** One part, as the person said it, and the lookup made for it. */
export interface MealPartLookup extends BookLookup {
  /** Their words for this part, amount included — what the card's `said` carries back. */
  said: string;
}

/** One lookup per distinct part, the amount peeled off into its measure. */
export function partsToLookups(text: string): MealPartLookup[] {
  const seen = new Set<string>();
  return splitMealParts(text)
    .map((said) => {
      const { q, measure } = stripAmount(said);
      return { said, q: q.slice(0, 80), measure, brand: null };
    })
    .filter((l) => {
      const k = l.q.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export interface BookEntry {
  id: string;
  source: FoodSourceName;
  /** Null for a transient record (researched, not stored). Only a stored record can be picked. */
  food_id: string | null;
  name: string;
  brand: string | null;
  /** Per gram, from the record's own stated measure. Null when the record does not say. */
  per_g: { kcal: number | null; protein_g: number | null };
  /** Every measure the record offers, one entry per label, the headline measure included. */
  measures: MeasureOption[];
  completeness: NutritionTier;
  /** No usable calories: kcal missing or zero. Shown to the model, never hidden from it. */
  incomplete: boolean;
}

export interface BookSection {
  lookup: BookLookup;
  entryIds: string[];
  checked: SourceCheck[];
  disagreements: string[];
  text: string;
}

const fmt = (n: number | null | undefined, dp = 0): string => (typeof n === 'number' ? n.toFixed(dp) : '?');

/**
 * One entry per label. The record's headline measure is usually in its list too, and listing it
 * twice made every match on it ambiguous — which the matcher rightly refuses (2026-10-29 run).
 */
export function uniqueMeasures(ms: MeasureOption[]): MeasureOption[] {
  const seen = new Set<string>();
  return ms.filter((m) => {
    const k = m.label.trim().toLowerCase();
    if (seen.has(k) || !(m.grams > 0)) return false;
    seen.add(k);
    return true;
  });
}

function entryOf(id: string, c: SourceCandidate): BookEntry {
  const g = c.per.grams;
  const n = c.per.nutrients as Record<string, number | undefined>;
  const perG = (k: string): number | null => (g && typeof n[k] === 'number' ? (n[k] as number) / g : null);
  const kcal = perG('kcal');
  return {
    id,
    source: c.source,
    food_id: c.food_id,
    name: c.name,
    brand: c.brand,
    per_g: { kcal, protein_g: perG('protein_g') },
    measures: uniqueMeasures([...c.measures, ...(g ? [{ label: c.per.measure, grams: g }] : [])]),
    completeness: c.completeness,
    incomplete: kcal === null || kcal <= 0,
  };
}

/** Appends FatSecret's top rows to a fan-out result, so she sees every latte and not the first. */
export function withFatSecretRows(base: FanOutResult, rows: SourceCandidate[]): FanOutResult {
  const have = new Set(base.candidates.map((c) => `${c.source}|${c.food_id ?? c.name}`));
  const fresh = rows.filter((r) => !have.has(`${r.source}|${r.food_id ?? r.name}`));
  return { ...base, candidates: [...base.candidates, ...fresh] };
}

/** The per-meal id space. The same record seen twice keeps its first id. */
export class CandidateBook {
  readonly entries = new Map<string, BookEntry>();
  readonly sections: BookSection[] = [];
  private readonly byKey = new Map<string, string>();

  private register(c: SourceCandidate): BookEntry {
    const key = `${c.source}|${c.food_id ?? ''}|${c.name}|${c.brand ?? ''}`;
    const known = this.byKey.get(key);
    if (known) return this.entries.get(known)!;
    const id = `c${this.entries.size + 1}`;
    const entry = entryOf(id, c);
    this.byKey.set(key, id);
    this.entries.set(id, entry);
    return entry;
  }

  /** Add one lookup's answer. Nothing is ranked or dropped; the first SHOW_PER_LOOKUP are shown. */
  add(lookup: BookLookup, r: FanOutResult): BookSection {
    const head = `Lookup "${lookup.q}"${lookup.brand ? ` brand ${lookup.brand}` : ''}${lookup.measure ? ` at ${lookup.measure}` : ''}:`;
    const shown = r.candidates.slice(0, SHOW_PER_LOOKUP);
    const entries = shown.map((c) => ({ c, e: this.register(c) }));
    const lines = entries.map(({ c, e }) => {
      const per100 = (k: string): string => {
        const v = e.per_g[k as 'kcal' | 'protein_g'];
        return fmt(v === null || v === undefined ? null : v * 100, 1);
      };
      const g = c.per.grams;
      const nut = c.per.nutrients as Record<string, number | undefined>;
      const per100Of = (k: string): string =>
        fmt(g && typeof nut[k] === 'number' ? ((nut[k] as number) * 100) / g : null, 1);
      const measures = e.measures.map((m) => `${m.label} = ${fmt(m.grams, 1)} g`);
      return (
        `  ${e.id} · ${c.source} · ${c.name}${c.brand ? ` (${c.brand})` : ''} · per 100 g: ${per100('kcal')} kcal, ` +
        `${per100('protein_g')} g protein, ${per100Of('carbs_g')} g carbs, ${per100Of('fat_g')} g fat · ` +
        `measures: ${measures.join('; ') || 'grams only'} · completeness: ${c.completeness}` +
        (e.incomplete ? ' · incomplete: no usable calories' : '') +
        (c.notes.length ? ` · notes: ${c.notes.join('; ')}` : '')
      );
    });
    const disagreements = r.disagreements.map((d) => `  where they disagree: ${d}`);
    const text = shown.length ? [head, ...lines, ...disagreements].join('\n') : `${head}\n  no records on file`;
    const section: BookSection = {
      lookup,
      entryIds: entries.map(({ e }) => e.id),
      checked: r.sources_checked,
      disagreements: r.disagreements,
      text,
    };
    this.sections.push(section);
    return section;
  }

  /** The whole book as the model reads it. */
  text(): string {
    return this.sections.length ? this.sections.map((s) => s.text).join('\n\n') : '(nothing found for any part)';
  }

  /** Every record found so far — for the eval's scorer and for checking a pick. */
  shown(): Map<string, BookEntry> {
    return this.entries;
  }
}

export type BookLookupFn = (lookup: BookLookup) => Promise<FanOutResult>;

/** Look every part up at once and add the answers in the parts' order. */
export async function addLookups(
  book: CandidateBook,
  lookups: BookLookup[],
  lookup: BookLookupFn,
): Promise<BookSection[]> {
  const found = await Promise.all(lookups.map((l) => lookup(l)));
  return found.map((r, i) => book.add(lookups[i]!, r));
}

/* ── Checking a pick against the book ─────────────────────────────────────────────────────── */

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');
/**
 * "1 medium (118g)" → "1 medium": source labels carry their grams in brackets; a model drops them.
 * "1 medium = 118.0 g" → "1 medium": a model copies the "= grams" the book prints after a label.
 */
const bare = (s: string): string => norm(s.replace(/\([^)]*\)/g, '').replace(/\s*=\s*[\d.]+\s*g\b.*$/i, ''));

/**
 * The record's measure the model meant: exact, then ignoring bracketed asides, then the ONE label
 * that starts with what it wrote. Ambiguous or absent is no match — never a guess.
 */
export function matchBookMeasure<M extends { label: string }>(measures: M[], wanted: string): M | null {
  const want = norm(wanted);
  if (!want) return null;
  const exact = measures.find((m) => norm(m.label) === want);
  if (exact) return exact;
  const byBare = measures.filter((m) => bare(m.label) === bare(want));
  if (byBare.length === 1) return byBare[0]!;
  const prefixed = measures.filter((m) => norm(m.label).startsWith(want));
  return prefixed.length === 1 ? prefixed[0]! : null;
}

export interface PickInput {
  pick: string;
  measure: string | null;
  count: number | null;
}

export type CheckedPick =
  { ok: true; entry: BookEntry; measure: MeasureOption; count: number; grams: number } | { ok: false; problem: string };

const GRAMS = new Set(['g', 'gram', 'grams']);

/**
 * Is this pick something the book offered? Only an id that was shown, and only a measure that
 * record offers (or grams). A failed check reports why, in words that go back to the model as
 * evidence — a guard reports, it does not silently veto.
 */
export function checkPick(input: PickInput, book: Pick<CandidateBook, 'entries'>): CheckedPick {
  const entry = book.entries.get(input.pick);
  if (!entry) return { ok: false, problem: `pick "${input.pick}" is not an id in the book` };
  if (!entry.food_id) return { ok: false, problem: `${entry.id} is not a stored record and cannot be logged` };
  const count = typeof input.count === 'number' && input.count > 0 && Number.isFinite(input.count) ? input.count : 1;
  const want = norm(input.measure ?? '');
  if (GRAMS.has(want)) return { ok: true, entry, measure: { label: 'g', grams: 1 }, count, grams: count };
  const measure = matchBookMeasure(entry.measures, want);
  if (!measure) {
    const offered = entry.measures.map((m) => m.label).join('; ') || 'grams only';
    return {
      ok: false,
      problem: `measure "${input.measure ?? ''}" is not one ${entry.id} offers; it offers: ${offered}`,
    };
  }
  return { ok: true, entry, measure, count, grams: measure.grams * count };
}
