/**
 * The food-check: one call to a small model with the words, the slot and the candidate book; it
 * picks, assumes, or asks (docs/cadence/FOOD-LOGGING-COACH-LED.md, owner 2026-10-29). The job is
 * `food-check` in config/ai-admin/ai-admin.config.json, on its own profile (`cadence-food-check`:
 * claude-sonnet-5-5, gpt-5.4-mini failover — ruling 1 as amended 2026-11-03: the web round is
 * reached only by a model that asks for it, and the small model asked 1 in 5).
 *
 * The SHAPE bounds it, not the wording. Run 2's eggs plate: told "this is your last reply" while
 * lookups were still on offer, every model asked for more anyway; with the offer removed from the
 * last call, every model answered. So:
 *   - call 1 may ask for more lookups once — for a part the split got wrong, a typo, a part
 *     missed. Those lookups are made and the book grows.
 *   - call 2 is the last. Its prompt offers no lookups, and any it asks for are not made.
 *   - a lookup of that round with a maker named goes to the web as well (food-web-lookup.ts),
 *     at most WEB_LOOKUPS_PER_MEAL of them: the one place the slow rung runs (owner, 2026-11-03).
 *   - a pick that is not in the book, or a measure the record does not offer, goes back once as
 *     evidence (TOOL-HARNESS.md: a guard reports, it does not silently veto). After the last
 *     call the row becomes the model's estimate if it gave one, or an open row that counts nothing.
 * At most FOOD_CHECK_MAX_CALLS calls per meal, whatever the model does.
 *
 * Pure apart from its deps: `call` runs the job with the template's variables (production:
 * runJobBySlug; the eval: the same variables through an e2e job), `lookup` answers a lookup, and
 * `web`, when given, answers a second-round lookup from the web.
 */
import { QUESTION_CHOICES_MAX, QUESTION_CHOICE_MAX_CHARS } from '@cadence/shared';
import {
  MAX_PARTS,
  SAID_MAX,
  addLookups,
  checkPick,
  type BookLookup,
  type BookLookupFn,
  type CandidateBook,
} from './food-candidate-book.ts';
import type { FanOutResult, SourceCheck } from './food-source-fanout.ts';
import type { SourceCandidate } from './food-source-report.ts';

export const FOOD_CHECK_JOB = 'food-check';
/** Model calls per meal, at most. The second is the last, and it offers no lookups. */
export const FOOD_CHECK_MAX_CALLS = 2;
/** Lookups the first call may ask for. */
export const MAX_LOOKUPS = 8;
/** Of those, the ones with a maker named that also go to the web — at most this many a meal. */
export const WEB_LOOKUPS_PER_MEAL = 2;

/** The `round_rule` the prompt carries on a call that may still ask for lookups. */
export const ROUND_RULE_OPEN =
  "Lookups: put up to 8 entries in lookups and leave items empty when a part of the meal has no fitting record in <book> — the words were split wrongly, a typo, a part was missed — and when they named a maker and every record naming it has a restaurant or chain in brackets: that is the restaurant's menu row of it, not the maker's own, which is not on file yet. Then ask with the food in q and that maker in brand; a lookup with a brand is also made on the web, which takes longer and is where the maker's own numbers are. Put the plain food name in q. Put a brand only if they named one. Otherwise leave lookups empty and answer with items now.";
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
  /**
   * With a question: the short answers the person could tap, in plain words ("Whole milk", "2%",
   * "Skim"). Null when the question has no short list (an amount), and always null without a
   * question. The card draws one button each and keeps typing open (FOOD-LOGGING-COACH-LED.md,
   * "chips in her voice"; owner 2026-11-01).
   */
  choices: string[] | null;
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

/** What the web answers for one lookup: rows that can be picked (stored), and its line in the trace. */
export interface WebRows {
  rows: SourceCandidate[];
  check: SourceCheck;
}
export type WebLookupFn = (lookup: BookLookup) => Promise<WebRows>;

export interface FoodCheckDeps {
  call: (vars: FoodCheckVars) => Promise<string>;
  lookup: BookLookupFn;
  /** The web, for a second-round lookup with a maker named. Absent: no lookup goes to the web. */
  web?: WebLookupFn;
}

export interface FoodCheckOutcome {
  items: FoodCheckItem[];
  /** By item index: the check that still failed after the last call. Empty means every pick counts. */
  problems: Map<number, string>;
  calls: number;
  /** The extra lookups the model asked for and got. */
  lookups: BookLookup[];
  /** Of those, the ones that went to the web as well. */
  web: BookLookup[];
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

/**
 * The answers offered with a question, as buttons: each trimmed to a button's worth, blanks and
 * repeats (case apart) dropped, at most QUESTION_CHOICES_MAX kept. Null when nothing is left —
 * the card then asks the amount, as it did before choices existed.
 */
export function readChoices(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of v) {
    const t = str(c, QUESTION_CHOICE_MAX_CHARS);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length === QUESTION_CHOICES_MAX) break;
  }
  return out.length ? out : null;
}

function readItem(v: unknown): FoodCheckItem | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const e = o.estimate && typeof o.estimate === 'object' ? (o.estimate as Record<string, unknown>) : null;
  const estimate =
    e && (num(e.kcal) !== null || num(e.protein_g) !== null)
      ? { kcal: num(e.kcal), protein_g: num(e.protein_g) }
      : null;
  const question = str(o.question, 300);
  return {
    said: str(o.said, SAID_MAX) ?? '',
    name: str(o.name, 80),
    brand: str(o.brand, 120),
    pick: str(o.pick, 16),
    measure: str(o.measure, 80),
    count: num(o.count),
    assumption: str(o.assumption, 300),
    question,
    // Choices answer a question; without one they answer nothing and are dropped.
    choices: question ? readChoices(o.choices) : null,
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

/** The lookups of a round that go to the web too: those with a maker named, the first WEB_LOOKUPS_PER_MEAL of them. */
export function webbed(lookups: BookLookup[]): Set<BookLookup> {
  return new Set(lookups.filter((l) => !!l.brand).slice(0, WEB_LOOKUPS_PER_MEAL));
}

const webCheck = (status: SourceCheck['status'], detail: string): SourceCheck => ({
  source: 'research',
  status,
  ms: 0,
  detail,
});

/**
 * The web's rows go first in the section. The book ranks nothing: it deals a lookup's rows
 * round-robin by source, in the order the sources first appear, and shows the first
 * SHOW_PER_LOOKUP of the deal (`dealBySource`). A row in front of the result is its source's first
 * and the first dealt, so the row the web found — the one she asked for — is the first line of
 * its section and never the ninth and unseen; `food-candidate-book.test.ts` pins that.
 */
export function withWebRows(base: FanOutResult, web: WebRows): FanOutResult {
  const key = (c: SourceCandidate): string => `${c.source}|${c.food_id ?? c.name}`;
  const have = new Set(web.rows.map(key));
  return {
    ...base,
    candidates: [...web.rows, ...base.candidates.filter((c) => !have.has(key(c)))],
    sources_checked: [...base.sources_checked, web.check],
  };
}

/** One second-round lookup: the sources, and the web too when this lookup is one of the webbed. */
async function lookupAndWeb(l: BookLookup, deps: FoodCheckDeps, go: boolean): Promise<FanOutResult> {
  if (!deps.web || !l.brand) return deps.lookup(l);
  if (!go) {
    const base = await deps.lookup(l);
    const skipped = webCheck('skipped', `at most ${WEB_LOOKUPS_PER_MEAL} web lookups a meal`);
    return { ...base, sources_checked: [...base.sources_checked, skipped] };
  }
  const [base, web] = await Promise.all([
    deps.lookup(l),
    deps.web(l).catch((e: unknown): WebRows => ({
      rows: [],
      check: webCheck('error', e instanceof Error ? e.message : String(e)),
    })),
  ]);
  return withWebRows(base, web);
}

/**
 * Run the check over a book already filled for every part. The book grows only if the first
 * call asks for lookups; the second call sees the grown book and is the last.
 */
export async function foodCheckRounds(
  input: { meal: string; said: string; book: CandidateBook; notes?: string },
  deps: FoodCheckDeps,
): Promise<FoodCheckOutcome> {
  const out: FoodCheckOutcome = { items: [], problems: new Map(), calls: 0, lookups: [], web: [], error: null };
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
      const toWeb = deps.web ? webbed(reply.lookups) : new Set<BookLookup>();
      out.web.push(...toWeb);
      await addLookups(input.book, reply.lookups, (l) => lookupAndWeb(l, deps, toWeb.has(l)));
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
