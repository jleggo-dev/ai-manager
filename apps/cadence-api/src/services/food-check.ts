/**
 * The food-check: one call to a small model with the words, the slot and the candidate book; it
 * picks, assumes, or asks (docs/cadence/FOOD-LOGGING-COACH-LED.md, owner 2026-10-29). The job is
 * `food-check` in config/ai-admin/ai-admin.config.json, on its own profile (`cadence-food-check`:
 * gpt-5.4-mini, claude-sonnet-5-5 failover — ruling 1, confirmed by eval run 2).
 *
 * The SHAPE bounds it, not the wording. Run 2's eggs plate: told "this is your last reply" while
 * lookups were still on offer, every model asked for more anyway; with the offer removed from the
 * last call, every model answered. So:
 *   - call 1 may ask for more lookups once — for a part the split got wrong, a typo, a part
 *     missed. Those lookups are made and the book grows.
 *   - call 2 is the last. Its prompt offers no lookups, and any it asks for are not made.
 *   - a pick that is not in the book, or a measure the record does not offer, goes back once as
 *     evidence (TOOL-HARNESS.md: a guard reports, it does not silently veto). After the last
 *     call the row becomes the model's estimate if it gave one, or an open row that counts nothing.
 * At most FOOD_CHECK_MAX_CALLS calls per meal, whatever the model does.
 *
 * Pure apart from its two deps: `call` runs the job with the template's variables (production:
 * runJobBySlug; the eval: the same variables through an e2e job), `lookup` answers a lookup.
 */
import {
  MAX_PARTS,
  SAID_MAX,
  addLookups,
  checkPick,
  type BookLookup,
  type BookLookupFn,
  type CandidateBook,
} from './food-candidate-book.ts';

export const FOOD_CHECK_JOB = 'food-check';
/** Model calls per meal, at most. The second is the last, and it offers no lookups. */
export const FOOD_CHECK_MAX_CALLS = 2;
/** Lookups the first call may ask for. */
export const MAX_LOOKUPS = 8;

/** The `round_rule` the prompt carries on a call that may still ask for lookups. */
export const ROUND_RULE_OPEN =
  'Lookups: only if a part of the meal has no fitting record in <book> because the words were split wrongly, a typo, or a part was missed, put up to 8 entries in lookups and leave items empty. Put the plain food name in q. Put a brand only if they named one. Otherwise leave lookups empty and answer with items now.';
/** The `round_rule` on the last call. No lookups are offered, and none asked for are made. */
export const ROUND_RULE_LAST =
  'This is your last reply. Answer with items now, from the records in <book>. Leave lookups empty: no more lookups will be made. A part with no fitting record gets pick null and an estimate.';

export interface FoodCheckItem {
  said: string;
  /** For an estimate: the plain food name. Null for a pick (the record's name wins). */
  name: string | null;
  /** Only a brand the person named. */
  brand: string | null;
  pick: string | null;
  measure: string | null;
  count: number | null;
  assumption: string | null;
  question: string | null;
  estimate: { kcal: number | null; protein_g: number | null } | null;
}

export interface FoodCheckReply {
  items: FoodCheckItem[];
  lookups: BookLookup[];
}

/** The template's variables, exactly as config/ai-admin/ai-admin.config.json declares them. */
export interface FoodCheckVars {
  meal: string;
  said: string;
  book: string;
  round_rule: string;
  guard_notes: string;
  /**
   * What the photo reader could and could not tell about the meal (meal-photo-read.ts: the
   * sentences above the list), so a doubt there can become her question or her stated assumption
   * for that part (owner, 2026-11-01: "if it can't tell whole or skim milk, it should ask the
   * user"). Empty for a typed meal.
   */
  notes: string;
}

export interface FoodCheckDeps {
  call: (vars: FoodCheckVars) => Promise<string>;
  lookup: BookLookupFn;
}

export interface FoodCheckOutcome {
  items: FoodCheckItem[];
  /** By item index: the check that still failed after the last call. Empty means every pick counts. */
  problems: Map<number, string>;
  calls: number;
  /** The extra lookups the model asked for and got. */
  lookups: BookLookup[];
  /** Set when no usable reply came back. The caller falls back; the meal never vanishes. */
  error: string | null;
}

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t ? t : null;
};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The first JSON object in a reply. Strict output makes this the whole reply; prose around it is tolerated. */
export function firstJsonObject(raw: string): Record<string, unknown> | null {
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try {
    const v = JSON.parse(raw.slice(s, e + 1)) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readItem(v: unknown): FoodCheckItem | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const e = o.estimate && typeof o.estimate === 'object' ? (o.estimate as Record<string, unknown>) : null;
  const estimate =
    e && (num(e.kcal) !== null || num(e.protein_g) !== null)
      ? { kcal: num(e.kcal), protein_g: num(e.protein_g) }
      : null;
  return {
    said: str(o.said, SAID_MAX) ?? '',
    name: str(o.name, 80),
    brand: str(o.brand, 120),
    pick: str(o.pick, 16),
    measure: str(o.measure, 80),
    count: num(o.count),
    assumption: str(o.assumption, 300),
    question: str(o.question, 300),
    estimate,
  };
}

function readLookup(v: unknown): BookLookup | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const q = str(o.q, 80);
  return q ? { q, measure: str(o.measure, 40), brand: str(o.brand, 60) } : null;
}

/**
 * Shape a reply. Null when there is no JSON object, or neither list is present. Items are capped
 * at MAX_PARTS: the split never makes more parts than that, and the confirm takes at most twelve
 * rows (validation/body.ts), so a longer list is the model adding parts nobody said.
 */
export function parseFoodCheckReply(raw: string): FoodCheckReply | null {
  const o = firstJsonObject(raw);
  if (!o) return null;
  const itemsIn = Array.isArray(o.items) ? o.items : null;
  const lookupsIn = Array.isArray(o.lookups) ? o.lookups : null;
  if (!itemsIn && !lookupsIn) return null;
  return {
    items: (itemsIn ?? [])
      .map(readItem)
      .filter((i): i is FoodCheckItem => i !== null)
      .slice(0, MAX_PARTS),
    lookups: (lookupsIn ?? [])
      .map(readLookup)
      .filter((l): l is BookLookup => l !== null)
      .slice(0, MAX_LOOKUPS),
  };
}

/**
 * Which picks the book cannot honour, by item index, each with the reason as evidence. An item
 * that carries a question is not checked: its pick is tentative and the card never uses it
 * (food-described-rows.ts), so the one guard retry is not spent complaining about it.
 */
export function checkItems(
  items: FoodCheckItem[],
  book: Pick<CandidateBook, 'entries' | 'shown'>,
): Map<number, string> {
  const problems = new Map<number, string>();
  items.forEach((item, i) => {
    if (!item.pick || item.question) return;
    const r = checkPick({ pick: item.pick, measure: item.measure, count: item.count }, book);
    if (!r.ok) problems.set(i, r.problem);
  });
  return problems;
}

/** The `guard_notes` variable: empty, or the previous reply's problems for the model to fix. */
export function guardNotes(items: FoodCheckItem[], problems: Map<number, string>): string {
  if (!problems.size) return '';
  const lines = [...problems].map(([i, p]) => `- item ${i + 1} ("${items[i]?.said ?? ''}"): ${p}`);
  return ['Your previous reply had problems. Fix them and answer again with items:', ...lines].join('\n');
}

/**
 * Run the check over a book already filled for every part. The book grows only if the first
 * call asks for lookups; the second call sees the grown book and is the last.
 */
export async function foodCheckRounds(
  input: { meal: string; said: string; book: CandidateBook; notes?: string },
  deps: FoodCheckDeps,
): Promise<FoodCheckOutcome> {
  const out: FoodCheckOutcome = { items: [], problems: new Map(), calls: 0, lookups: [], error: null };
  let previous: FoodCheckItem[] = [];
  let problems = new Map<number, string>();
  let lookedUp = false;

  for (let call = 1; call <= FOOD_CHECK_MAX_CALLS; call += 1) {
    const last = call === FOOD_CHECK_MAX_CALLS;
    const raw = await deps.call({
      meal: input.meal,
      said: input.said,
      book: input.book.text(),
      round_rule: last ? ROUND_RULE_LAST : ROUND_RULE_OPEN,
      guard_notes: guardNotes(previous, problems),
      notes: input.notes ?? '',
    });
    out.calls = call;

    const reply = parseFoodCheckReply(raw);
    if (!reply) {
      out.error = `call ${call}: no JSON reply`;
      return out;
    }
    // The one extra round of lookups, and only before the last call. On the last call a request
    // for lookups is not made: the shape, not the wording, is what holds the line.
    if (!last && !lookedUp && reply.lookups.length) {
      lookedUp = true;
      out.lookups.push(...reply.lookups);
      await addLookups(input.book, reply.lookups, deps.lookup);
      continue;
    }
    if (!reply.items.length) {
      out.error = `call ${call}: no items in the reply`;
      return out;
    }
    out.items = reply.items;
    out.problems = checkItems(reply.items, input.book);
    if (out.problems.size === 0 || last) return out;
    previous = reply.items;
    problems = out.problems;
  }
  return out;
}
