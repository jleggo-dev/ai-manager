/**
 * The single-call shape of the food-check (owner, 2026-10-29): software splits the words into
 * parts and looks every part up in every source BEFORE the model is called. The model then gets
 * one call with the whole candidate book and picks, assumes, or asks. It may request more lookups
 * once — for a part the deterministic split got wrong, or a typo no source could match — and the
 * second call is its last.
 *
 * This is the harness order the owner asked for: the orchestration is software's, the judgement
 * is hers. Compared with eval-food-check-protocol.ts, the model's first call ("what should I look
 * up?") is gone, because the split and the fan-out are deterministic work.
 *
 * The split here is deliberately plain. Comma, newline, "and", "with", "+", "&" separate parts;
 * a leading amount ("150ml", "2 tbsp", "a handful of") is peeled off into `measure`. Dictated prose
 * with no separators stays one part — the eval counts how often that forces the second round.
 */
import type { FanOutResult } from '../src/services/food-source-fanout.ts';
import type { SourceCandidate } from '../src/services/food-source-report.ts';
import type { FoodCheckCase } from './eval-food-check-cases.ts';
import {
  CandidateBook,
  firstJson,
  readFinal,
  readLookups,
  type Lookup,
  type MealDeps,
  type MealRun,
} from './eval-food-check-protocol.ts';

export const SINGLE_MAX_ROUNDS = 2;
const MAX_PARTS = 10;

const SEPARATORS = /\s*(?:,|;|\n|\+|&|\band\b|\bwith\b|\bplus\b)\s*/i;
const AMOUNT =
  /^(?:(?:\d+(?:[./]\d+)?|\d*\.\d+|a|an|one|two|three|four|half|quarter|a few|some|a bit of|a splash of)\s*)?(?:(?:ml|l|g|kg|grams?|oz|ounces?|lbs?|cups?|c|tbsp|tablespoons?|tsp|teaspoons?|slices?|shots?|scoops?|cans?|pieces?|handful|small|medium|large)\b\s*)?(?:of\s+)?/i;

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
  return { q, measure: measure && /\d|cup|tbsp|tsp|oz|ml|g\b|slice|shot|scoop|handful|small|medium|large|half|quarter/i.test(measure) ? measure : null };
}

export function partsToLookups(text: string): Lookup[] {
  const seen = new Set<string>();
  return splitMealParts(text)
    .map((p) => {
      const { q, measure } = stripAmount(p);
      return { q: q.slice(0, 80), measure, brand: null };
    })
    .filter((l) => {
      const k = l.q.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export function buildSinglePrompt(c: FoodCheckCase, results: string[], lastRound: boolean): string {
  return [
    'You check one meal a person logged. You decide which food records describe what they ate.',
    '',
    `Meal: ${c.meal}. What they said: "${c.text}"`,
    '',
    'Each part of what they said has already been looked up. The records found are listed below.',
    'Reply with ONE JSON object and nothing else.',
    '',
    'Usually you can answer now: reply {"final":{"items":[ ... ]}} with one entry per part of the meal:',
    '{"said":"their words for this part","pick":"c3","measure":"1 cup","count":1.5,"assumption":null,"question":null,"estimate":null}',
    '',
    ...(lastRound
      ? ['This is your last reply. Answer with final now, from the records below. A part with no fitting record gets pick null and an estimate.', '']
      : [
          'Only if a part of the meal has no fitting record below — the words were split wrongly, a typo, a part missed — you may reply',
          '{"lookups":[{"q":"food name","measure":"1 cup","brand":null}]} once, with at most 8 lookups. Put the plain food name in q. Put a brand only if they named one.',
          '',
        ]),
    'Rules:',
    '- pick must be an id shown in the lookup results below. Never invent an id.',
    '- measure must be one of the measures listed for that record, or "g" with count = grams.',
    '- count multiplies the measure.',
    '- Do not write calories or protein for a picked record. They are worked out from the record.',
    '- If no record fits, set pick to null and give estimate as {"kcal":number,"protein_g":number}. It is shown to the person as your estimate.',
    '- If the words leave the amount or the kind open, still answer. Write what you assumed in assumption, or the one question you would ask in question.',
    '- Where records disagree, choose the one that matches what they said. Say why in assumption when it changes the numbers.',
    '',
    'Lookup results:',
    results.length ? results.join('\n\n') : '(nothing found for any part)',
  ].join('\n');
}

export interface SingleDeps extends MealDeps {
  /** Everything a source has to say, FatSecret's top rows included — the candidate book she reads. */
  lookupWide: (l: Lookup) => Promise<FanOutResult>;
}

/** One meal, single-call shape: split → fan out → one model call (→ at most one more). */
export async function runMealSingle(c: FoodCheckCase, deps: SingleDeps): Promise<MealRun> {
  const book = new CandidateBook();
  const results: string[] = [];
  const out: MealRun = { rounds: [], lookups: [], final: null, shown: book.shown, error: null };

  const first = partsToLookups(c.text);
  out.lookups.push(...first);
  const found = await Promise.all(first.map((l) => deps.lookupWide(l)));
  found.forEach((f, i) => results.push(book.render(first[i]!, f)));

  for (let round = 1; round <= SINGLE_MAX_ROUNDS; round++) {
    let r;
    try {
      r = await deps.run(buildSinglePrompt(c, results, round === SINGLE_MAX_ROUNDS));
    } catch (e) {
      out.error = `round ${round} failed: ${String(e).slice(0, 200)}`;
      return out;
    }
    out.rounds.push(r);
    const o = firstJson(r.raw);
    if (!o) {
      out.error = `round ${round}: no JSON in reply`;
      return out;
    }
    const final = readFinal(o);
    if (final) {
      out.final = final;
      return out;
    }
    const more = readLookups(o);
    if (!more.length) {
      out.error = `round ${round}: neither lookups nor final`;
      return out;
    }
    out.lookups.push(...more);
    const again = await Promise.all(more.map((l) => deps.lookupWide(l)));
    again.forEach((f, i) => results.push(book.render(more[i]!, f)));
  }
  out.error = `no final answer after ${SINGLE_MAX_ROUNDS} rounds`;
  return out;
}

/** Appends FatSecret's top rows to a fan-out result, so she sees every latte and not the first. */
export function withFatSecretRows(base: FanOutResult, rows: SourceCandidate[]): FanOutResult {
  const have = new Set(base.candidates.map((c) => `${c.source}|${c.food_id ?? c.name}`));
  const fresh = rows.filter((r) => !have.has(`${r.source}|${r.food_id ?? r.name}`));
  return { ...base, candidates: [...base.candidates, ...fresh] };
}
