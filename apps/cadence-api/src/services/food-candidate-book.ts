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
 * left in — the model is told, not protected (run 2 picked a zero-kcal "Cafe Latte" once). A
 * record kept per item (a pinned estimate, "1 serving = 1") is printed per its own measure, not as
 * "per 100 g" of a count — that read 25,000 kcal and raised a false disagreement.
 *
 * What the book will not do is grow without limit: `text()` fits itself to BOOK_BUDGET_CHARS
 * (its own budget, from the token bar — round-robin by part, the cut announced in the part's
 * head), and `shown()` answers only with the records the last rendering held, so a pick of a
 * record the model never saw is refused rather than priced.
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
/**
 * Their words for one part, at most — the confirm's own cap on `said` (validation/body.ts), so a
 * row's words always ride back and the key the memory was asked with is the key the confirm
 * teaches. A part longer than this is a sentence, not a food; the first 200 characters are read.
 */
export const SAID_MAX = 200;
/**
 * The most characters the rendered book may run to — a budget of the book's own, sized from the
 * cost target and not from the engine (whose cap on a job variable is 40,000 since #454, and a
 * cut there is logged with the variable's name, never silent).
 *
 * The arithmetic. The bar is ~4,800 prompt tokens a call (FOOD-LOGGING-COACH-LED.md, run 2).
 * Run 4 measured this prompt at ~3.7 characters a token on top of the ~2,600 tokens of gateway
 * preamble every call carries: the five-part smoothie's call, a 9,700-character book plus the
 * 3,100-character template, the words and the round rule (~14,000 characters), cost ~6,300
 * tokens. Eight records are ~2,400 characters a part, so a meal of one to three parts never
 * fills the budget and the MEDIAN call sits under the bar whatever it is set to; the budget
 * decides what a long meal costs and how many of each part's rows it keeps. At 12,000 a filled
 * call is ~7,000 tokens and a ten-part meal keeps three or four rows a part; at 9,900 (the
 * engine's old cap, run 4) it was ~6,400 and two or three. Filled round-robin across the parts,
 * the cut announced in the part's head, so the model can ask for a narrower lookup rather than
 * read a cut it cannot see.
 */
export const BOOK_BUDGET_CHARS = 12_000;
/** Room kept per section for the "N more records not shown" note a cut adds to its head. */
const CUT_NOTE_RESERVE = 110;

const SEPARATORS = /\s*(?:,|;|\n|\+|&|\band\b|\bwith\b|\bplus\b)\s*/i;
/**
 * The amount in front of a part. The number WORDS end on a word boundary and the longer ones come
 * first: without that, "a" matched the first letter of "avocado", "apple" and "almonds" ("vocado
 * toast" was looked up, 2026-11-01), and "a few eggs" read as the food "few eggs".
 */
const AMOUNT =
  /^(?:(?:\d+(?:[./]\d+)?|\d*\.\d+|(?:a few|a bit of|a splash of|an|a|one|two|three|four|half|quarter|some)\b)\s*)?(?:(?:ml|l|g|kg|grams?|oz|ounces?|lbs?|cups?|c|tbsp|tablespoons?|tsp|teaspoons?|slices?|shots?|scoops?|cans?|pieces?|handful|small|medium|large)\b\s*)?(?:of\s+)?/i;
const MEASURE_WORD = /\d|cup|tbsp|tsp|oz|ml|g\b|slice|shot|scoop|handful|small|medium|large|half|quarter/i;

/** Every part, in order, as the person wrote them — no cap. Never empty for non-blank text. */
function splitAllParts(text: string): string[] {
  const parts = text
    .split(SEPARATORS)
    .map((p) => p.replace(/^[\s.]+|[\s.]+$/g, ''))
    .filter(Boolean);
  return parts.length ? parts : [text.trim()].filter(Boolean);
}

/** The parts of a meal, in order, as the person wrote them, at most MAX_PARTS. Never empty for non-blank text. */
export function splitMealParts(text: string): string[] {
  return splitAllParts(text).slice(0, MAX_PARTS);
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

/**
 * The split's answer: one lookup per distinct part, the amount peeled off into its measure, and
 * what was NOT read — said in words the card and the coach can both show, because a part dropped
 * in silence reads as a meal that never had it (tool-response.ts rule 2). Two things are left
 * out: parts past MAX_PARTS, and a part said more than once (the same food, amount stripped, is
 * looked up once; "a latte, a latte" is one lookup and the line says so).
 */
export interface DescribedParts {
  lookups: MealPartLookup[];
  /** One line per part not read, e.g. `"berries" not read — the read takes at most 10 parts`. */
  not_read: string[];
}

export function describedParts(text: string): DescribedParts {
  const all = splitAllParts(text);
  const kept = all.slice(0, MAX_PARTS);
  const not_read = all.slice(MAX_PARTS).map((p) => `"${p}" not read — the read takes at most ${MAX_PARTS} parts`);
  const byKey = new Map<string, { lookup: MealPartLookup; times: number }>();
  for (const part of kept) {
    const said = part.slice(0, SAID_MAX);
    const { q, measure } = stripAmount(said);
    const lookup: MealPartLookup = { said, q: q.slice(0, 80), measure, brand: null };
    const k = lookup.q.toLowerCase();
    const seen = byKey.get(k);
    if (seen) seen.times += 1;
    else byKey.set(k, { lookup, times: 1 });
  }
  for (const { lookup, times } of byKey.values()) {
    if (times > 1) not_read.push(`"${lookup.q}" said ${times === 2 ? 'twice' : `${times} times`}, read once`);
  }
  return { lookups: [...byKey.values()].map((v) => v.lookup), not_read };
}

/** One lookup per distinct part, the amount peeled off into its measure. */
export function partsToLookups(text: string): MealPartLookup[] {
  return describedParts(text).lookups;
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
  /** The section's first line: what was looked up. */
  head: string;
  /** One line per record, in the order the sources returned them. */
  lines: string[];
  /** Records held back the last time the book was rendered, because of the budget. */
  omitted: number;
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

/** A food kept per item (a pinned estimate: "1 serving = 1") has no per-100 g numbers to print. */
const perItem = (c: Pick<SourceCandidate, 'base_unit'>): boolean => c.base_unit === 'item';

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
  /** Ids the last `text()` rendered; unset until the book has been rendered once. */
  private visible: Set<string> | null = null;

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
    const lines = entries.map(({ c, e }) => recordLine(c, e));
    const section: BookSection = {
      lookup,
      entryIds: entries.map(({ e }) => e.id),
      checked: r.sources_checked,
      disagreements: r.disagreements,
      head,
      lines,
      omitted: 0,
    };
    this.sections.push(section);
    return section;
  }

  /**
   * The whole book as the model reads it, within `budget`. Every section keeps its head; record
   * lines are dealt round-robin — the first row of every part, then the second — so a long meal
   * loses the eighth row of each part before any part loses its first. A section that had rows
   * held back says how many in its head. Disagreement notes come after every part's rows, while
   * room remains. What was rendered is what `shown()` answers from then on.
   */
  text(budget: number = BOOK_BUDGET_CHARS): string {
    if (!this.sections.length) return '(nothing found for any part)';
    const n = this.sections.length;
    const heads = this.sections.map((s) => (s.lines.length ? s.head : `${s.head}\n  no records on file`));
    const shownRows = this.sections.map(() => 0);
    const shownNotes = this.sections.map(() => 0);
    const room = budget - n * CUT_NOTE_RESERVE;
    let used = heads.reduce((sum, h) => sum + h.length, 0) + 2 * (n - 1);
    const fits = (line: string): boolean => used + line.length + 1 <= room;

    const most = Math.max(...this.sections.map((s) => s.lines.length));
    rows: for (let r = 0; r < most; r += 1) {
      for (let i = 0; i < n; i += 1) {
        const line = this.sections[i]!.lines[r];
        if (line === undefined) continue;
        if (!fits(line)) break rows;
        used += line.length + 1;
        shownRows[i] = r + 1;
      }
    }
    notes: for (let i = 0; i < n; i += 1) {
      for (const d of this.sections[i]!.disagreements) {
        const line = `  where they disagree: ${d}`;
        if (!fits(line)) break notes;
        used += line.length + 1;
        shownNotes[i] = (shownNotes[i] ?? 0) + 1;
      }
    }

    const visible = new Set<string>();
    const out = this.sections.map((s, i) => {
      s.omitted = s.lines.length - shownRows[i]!;
      s.entryIds.slice(0, shownRows[i]).forEach((id) => visible.add(id));
      const note = s.omitted
        ? ` (${s.omitted} more record${s.omitted === 1 ? '' : 's'} not shown for room; if none here fits, ask for a lookup with narrower words)`
        : '';
      const lines = s.lines.slice(0, shownRows[i]);
      const notes = s.disagreements.slice(0, shownNotes[i]).map((d) => `  where they disagree: ${d}`);
      return [heads[i]! + note, ...lines, ...notes].join('\n');
    });
    this.visible = visible;
    return out.join('\n\n');
  }

  /**
   * The records the model was actually shown — for checking a pick and for the eval's scorer.
   * Every record until the book is first rendered; after that, what the last rendering held.
   */
  shown(): Map<string, BookEntry> {
    if (!this.visible) return this.entries;
    return new Map([...this.entries].filter(([id]) => this.visible!.has(id)));
  }
}

/** One record as the model reads it: per 100 g for a food kept by weight, per its measure when kept per item. */
function recordLine(c: SourceCandidate, e: BookEntry): string {
  const g = c.per.grams;
  const nut = c.per.nutrients as Record<string, number | undefined>;
  const byItem = perItem(c);
  const per100Of = (k: string): string =>
    fmt(g && typeof nut[k] === 'number' ? ((nut[k] as number) * 100) / g : null, 1);
  const perMeasureOf = (k: string): string => fmt(typeof nut[k] === 'number' ? nut[k] : null, 1);
  const numberOf = byItem ? perMeasureOf : per100Of;
  const basis = byItem ? `per ${c.per.measure}` : 'per 100 g';
  const measures = byItem ? e.measures.map((m) => m.label) : e.measures.map((m) => `${m.label} = ${fmt(m.grams, 1)} g`);
  return (
    `  ${e.id} · ${c.source} · ${c.name}${c.brand ? ` (${c.brand})` : ''} · ${basis}: ${numberOf('kcal')} kcal, ` +
    `${numberOf('protein_g')} g protein, ${numberOf('carbs_g')} g carbs, ${numberOf('fat_g')} g fat · ` +
    `measures: ${measures.join('; ') || 'grams only'}` +
    (byItem ? ' · kept per item, not by weight: count multiplies the measure, grams are not offered' : '') +
    ` · completeness: ${c.completeness}` +
    (e.incomplete ? ' · incomplete: no usable calories' : '') +
    (c.notes.length ? ` · notes: ${c.notes.join('; ')}` : '')
  );
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
export function checkPick(input: PickInput, book: Pick<CandidateBook, 'entries' | 'shown'>): CheckedPick {
  const entry = book.shown().get(input.pick);
  if (!entry) {
    return {
      ok: false,
      problem: book.entries.has(input.pick)
        ? `pick "${input.pick}" was not shown in the book`
        : `pick "${input.pick}" is not an id in the book`,
    };
  }
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
