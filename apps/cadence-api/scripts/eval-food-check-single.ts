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
 * The split is deliberately plain (food-candidate-book.ts): comma, newline, "and", "with", "+", "&"
 * separate parts; a leading amount ("150ml", "2 tbsp", "a handful of") is peeled off into
 * `measure`. Dictated prose with no separators stays one part — the eval counts how often that
 * forces the second round.
 *
 * Two runners: `runMealSingle` is run 2's own prompt (buildSinglePrompt, kept so its numbers stay
 * reproducible); `runMealConfig` is the SHIPPED job — the service's split, book and round loop
 * (services/food-check.ts) sending the template's VARIABLES, so the engine fills the config's own
 * promptTemplate exactly as production: each variable wrapped in `<user_input name="…">`, each cut
 * at MAX_VARIABLE_LENGTH. The eval never builds the prompt itself (run 3 did, as one `{{prompt}}`
 * variable, and so never saw the wrapper or the cut).
 */
import type { FanOutResult } from '../src/services/food-source-fanout.ts';
import {
  CandidateBook as ServiceBook,
  addLookups,
  partsToLookups,
  type BookLookupFn,
} from '../src/services/food-candidate-book.ts';
import { foodCheckRounds, type FoodCheckVars } from '../src/services/food-check.ts';
import type { FoodCheckCase } from './eval-food-check-cases.ts';
import {
  CandidateBook,
  firstJson,
  readFinal,
  readLookups,
  type Lookup,
  type MealDeps,
  type MealRun,
  type RoundRun,
} from './eval-food-check-protocol.ts';

export const SINGLE_MAX_ROUNDS = 2;

/**
 * The split, the amount peel and the FatSecret merge moved into the service on 2026-11-01
 * (food-candidate-book.ts) when the shape shipped; re-exported so the run-2 eval keeps reading
 * the same way, from the one copy production runs.
 */
export { partsToLookups, splitMealParts, stripAmount, withFatSecretRows } from '../src/services/food-candidate-book.ts';

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
      ? [
          'This is your last reply. Answer with final now, from the records below. A part with no fitting record gets pick null and an estimate.',
          '',
        ]
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

export interface ConfigDeps {
  /** One call of a job that carries the shipped promptTemplate and variables; the engine fills it. */
  run: (vars: FoodCheckVars) => Promise<RoundRun>;
  /** The production lookup: the fan-out plus FatSecret's top rows (food-candidate-sources.ts). */
  lookup: BookLookupFn;
}

/**
 * One meal through the SHIPPED shape: the service's split and book, the config's prompt, the
 * service's round loop — the eval of what production runs, not of a prompt beside it.
 */
export async function runMealConfig(c: FoodCheckCase, deps: ConfigDeps): Promise<MealRun> {
  const book = new ServiceBook();
  const rounds: RoundRun[] = [];
  const lookups = partsToLookups(c.text);
  const out: MealRun = { rounds, lookups: [...lookups], final: null, shown: book.entries, error: null };
  await addLookups(book, lookups, deps.lookup);
  try {
    const outcome = await foodCheckRounds(
      { meal: c.meal, said: c.text, book },
      {
        call: async (vars: FoodCheckVars) => {
          const r = await deps.run(vars);
          rounds.push(r);
          return r.raw;
        },
        lookup: deps.lookup,
      },
    );
    out.lookups.push(...outcome.lookups);
    if (outcome.error) out.error = outcome.error;
    else out.final = outcome.items;
  } catch (e) {
    out.error = `failed: ${String(e).slice(0, 200)}`;
  }
  // What the model could pick from: the records the budgeted book actually rendered, not every
  // record found — an id past the cut is one it never saw.
  out.shown = book.shown();
  return out;
}
