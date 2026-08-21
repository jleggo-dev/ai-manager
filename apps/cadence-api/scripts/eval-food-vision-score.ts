/**
 * SCORING — deterministic on purpose.
 *
 * The obvious way to grade "is this a good description of a plate of food" is to ask a model. This
 * does not, and the reason is the doctrine the tool-selection eval already paid for: the grader
 * goes on trial before the thing it grades. An LLM judge here would be a second stochastic system
 * measuring a first, drifting between runs for reasons neither of us can see, and the numbers it
 * produced could not be compared week to week — which is the ONLY thing this harness is for.
 *
 * So the matching vocabulary lives in the case file, written by a person, and scoring is string
 * work over it. That buys comparability and costs nuance: a model that says "cultured dairy" for
 * yogurt scores a miss until somebody adds the alias. That is the right trade — a missing alias is
 * visible in the transcript the report prints, and gets fixed once, permanently.
 *
 * WHAT THE FOUR NUMBERS MEAN, and why these four:
 *   recall      — of the components actually present, how many did it name? The headline.
 *   invented    — did it claim something that is NOT there? Separate from recall, because they
 *                 trade off: a model that lists every food it can imagine scores perfect recall.
 *                 An invented side becomes calories in somebody's day, so this one is a defect.
 *   anchored    — did it tie a portion to an object in frame? Not "did it state a number": a
 *                 confident unanchored number is the failure mode, and it reads as success.
 *   hedged      — did it say what it could NOT tell? A description that admits the milk is
 *                 unknowable is worth more to stage 2 than one that quietly picks whole milk.
 */
import { PORTION_ANCHORS, UNCERTAINTY_MARKERS, type FoodVisionCase } from './eval-food-vision-cases.ts';

export interface DescriptionScore {
  found: string[];
  missed: string[];
  invented: string[];
  recall: number | null;
  anchors: string[];
  anchored: boolean;
  hedges: string[];
  hedged: boolean;
  words: number;
  /** True when the model refused, or said it cannot see images at all. */
  refused: boolean;
}

const REFUSALS = [
  "i'm unable to view",
  'unable to view',
  'cannot view',
  "can't view",
  'unable to see',
  'cannot see the image',
  "can't see the image",
  'i cannot process images',
  'no image was provided',
  'as a text-based',
  'i do not have the ability to see',
];

/**
 * Negations, and why they get their own list.
 *
 * The FIRST real run scored gpt-5-mini as having invented whipped cream on the latte. It had not —
 * it wrote "no visible whipped cream, syrups, or toppings", which is the prompt working exactly as
 * asked: say what is NOT there. A scorer that reads a denial as a claim punishes the behaviour the
 * harness is trying to reward, and it would have made a good description look like a hallucinating
 * one. Caught only because the run prints transcripts.
 */
const NEGATORS = [
  'no ',
  'not ',
  'none',
  'without',
  "n't",
  'nor ',
  'absent',
  'free of',
  'lacks',
  'lacking',
  'cannot see',
  "can't see",
  'do not see',
  "don't see",
  'never',
  'rather than',
  'instead of',
];
/** How far back to look for a negator. One clause — long enough for "no visible whipped cream". */
const NEGATION_WINDOW = 42;

function negatedAt(haystack: string, index: number): boolean {
  const from = Math.max(0, index - NEGATION_WINDOW);
  const window = haystack.slice(from, index);
  // Stop at a clause boundary so "there is cream. no sugar" does not negate the cream.
  const lastBreak = Math.max(window.lastIndexOf('.'), window.lastIndexOf(';'), window.lastIndexOf('\n'));
  const clause = lastBreak === -1 ? window : window.slice(lastBreak + 1);
  return NEGATORS.some((n) => clause.includes(n));
}

/** Word-boundary-ish containment: substring, but not inside a longer word (so "oat" ∌ "goat"). */
function mentions(haystack: string, needle: string, opts: { skipNegated?: boolean } = {}): boolean {
  const n = needle.toLowerCase().trim();
  if (!n) return false;
  let i = haystack.indexOf(n);
  while (i !== -1) {
    // Aliases are deliberately written as stems ("blueberr") so plurals match; only guard the LEFT
    // edge, where a false positive actually happens ("goat" containing "oat").
    const before = i === 0 ? ' ' : haystack[i - 1];
    const wordStart = !/[a-z]/.test(before as string);
    if (wordStart && !(opts.skipNegated && negatedAt(haystack, i))) return true;
    i = haystack.indexOf(n, i + n.length);
  }
  return false;
}

export function scoreDescription(text: string, c: FoodVisionCase): DescriptionScore {
  const t = (text || '').toLowerCase();
  const refused = REFUSALS.some((r) => t.includes(r));

  const found: string[] = [];
  const missed: string[] = [];
  for (const comp of c.components) {
    const hit = mentions(t, comp.name) || comp.aliases.some((a) => mentions(t, a));
    (hit ? found : missed).push(comp.name);
  }
  // skipNegated: "no whipped cream" is a denial, not a claim — see NEGATORS above.
  const invented = c.mustNotClaim.filter((x) => mentions(t, x, { skipNegated: true }));
  const anchors = PORTION_ANCHORS.filter((a) => t.includes(a.toLowerCase()));
  const hedges = UNCERTAINTY_MARKERS.filter((m) => t.includes(m.toLowerCase()));

  return {
    found,
    missed,
    invented,
    recall: c.components.length ? found.length / c.components.length : null,
    anchors,
    anchored: anchors.length > 0,
    hedges,
    hedged: hedges.length > 0,
    words: (text || '').trim().split(/\s+/).filter(Boolean).length,
    refused,
  };
}

export interface MacroScore {
  parsed: boolean;
  /** THE bug this whole thread started from: a parse that "worked" and produced no numbers. */
  hasNumbers: boolean;
  kcal: number | null;
  proteinG: number | null;
  itemCount: number;
  confidence: number | null;
  /** null when the case has no verified truth — skipped, never counted as a miss. */
  kcalErrorPct: number | null;
  parseError: string | null;
}

/** Pull JSON out of a reply that may be wrapped in prose or a ```json fence. */
export function extractJson(raw: string): Record<string, unknown> | null {
  const s = (raw || '').trim();
  if (!s) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? (fenced[1] as string) : s;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function scoreMacros(raw: string, c: FoodVisionCase): MacroScore {
  const obj = extractJson(raw);
  if (!obj) {
    return {
      parsed: false,
      hasNumbers: false,
      kcal: null,
      proteinG: null,
      itemCount: 0,
      confidence: null,
      kcalErrorPct: null,
      parseError: raw?.trim() ? 'no JSON object in reply' : 'empty reply',
    };
  }
  const est = (obj.est_macros ?? {}) as Record<string, number>;
  const items = Array.isArray(obj.items) ? obj.items : [];
  const kcal = typeof est.kcal === 'number' ? est.kcal : null;
  const proteinG = typeof est.protein_g === 'number' ? est.protein_g : null;
  const confidence = typeof obj.confidence === 'number' ? obj.confidence : null;

  return {
    parsed: true,
    // Numbers OR items: a drink with items and no macro block is a different failure from the
    // empty-everything one, and lumping them together is what hid the original bug.
    hasNumbers: Object.keys(est).length > 0 || items.length > 0,
    kcal,
    proteinG,
    itemCount: items.length,
    confidence,
    kcalErrorPct: c.kcal != null && kcal != null ? Math.round((Math.abs(kcal - c.kcal) / c.kcal) * 100) : null,
    parseError: null,
  };
}
