/**
 * `check_food_sources` — the fan-out, as a tool the Coach calls.
 *
 * This is the inversion the owner asked for, in one function. `lookup_food` hands her a ranked list
 * that the code already decided about; this hands her what every source SAID, including where they
 * disagree, and lets her decide. Per TOOL-HARNESS's opening principle: return facts in a consistent
 * shape and let her think.
 *
 * WHAT SHE GETS BACK, and why it is shaped this way (owner, 2026-08-23): *"the software should
 * return consistent usable information about a food type: macros… and nutrients by a quantity of a
 * measure (if it supports multiple, then the LLM tries to specify what is most important)."* So
 * every candidate states one named measure and lists the others, and asking for a different measure
 * is one more call rather than arithmetic she has to do in her head.
 *
 * WHAT IT DOES NOT DO: rank, filter, or pick. A thin row comes back labelled thin. Two sources that
 * disagree both come back, with the disagreement named. The guards report as `notes` rather than
 * dropping a record, because a source disagreeing with itself is information she can weigh and a
 * `null` is not.
 */
import { fanOutFoodSources, type FanOutResult, type SourceCheck } from '../food-source-fanout.ts';
import { hasFullMacros, type SourceCandidate } from '../food-source-report.ts';
import { toolFaultText } from '../tool-response.ts';
import type { RetrievalFunction } from './types.ts';

/** How many candidates to render. The rest are counted, never silently dropped. */
const RENDER_LIMIT = 6;

const NUTRIENT_LABELS: Array<[string, string, number]> = [
  ['kcal', 'kcal', 0],
  ['protein_g', 'protein', 1],
  ['carbs_g', 'carbs', 1],
  ['fat_g', 'fat', 1],
  ['fiber_g', 'fibre', 1],
  ['sodium_mg', 'sodium mg', 0],
  ['iron_mg', 'iron mg', 1],
  ['calcium_mg', 'calcium mg', 0],
  ['potassium_mg', 'potassium mg', 0],
  ['zinc_mg', 'zinc mg', 1],
  ['vitamin_c_mg', 'vit C mg', 1],
  ['vitamin_b12_ug', 'B12 µg', 1],
];

function nutrientLine(c: SourceCandidate): string {
  const n = c.per.nutrients as Record<string, unknown>;
  const parts: string[] = [];
  for (const [key, label, dp] of NUTRIENT_LABELS) {
    const v = n[key];
    if (typeof v === 'number') parts.push(`${Number(v.toFixed(dp))} ${label}`);
  }
  return parts.length ? parts.join(' · ') : 'no numbers on this record';
}

/** A source line for the trace: what ran, how long it took, and what came of it. */
function checkLine(c: SourceCheck): string {
  const took = c.ms > 0 ? ` (${c.ms}ms)` : '';
  return `- ${c.source}: ${c.status}${took}${c.detail ? ` — ${c.detail}` : ''}`;
}

function candidateBlock(c: SourceCandidate): string {
  const title = [c.name, c.brand ? `(${c.brand})` : ''].filter(Boolean).join(' ');
  const lines = [
    /**
     * The id is printed because `resolve_portion` REQUIRES one, and without it here the two tools
     * cannot be chained: she would be told a source has no "1/4 cup" measure and pointed at a tool
     * she has no way to address. A tool that names a follow-up must hand over what the follow-up
     * needs.
     */
    `[${c.source}] ${title} — per ${c.per.measure}${c.food_id ? ` · food_id ${c.food_id}` : ' · not saved yet'}`,
    `    ${nutrientLine(c)}`,
    `    completeness: ${c.completeness}${hasFullMacros(c) ? '' : ' (macros incomplete)'} · micros: ${c.micros}`,
  ];
  if (c.measures.length > 1) {
    const others = c.measures
      .slice(0, 6)
      .map((m) => `${m.label}=${m.grams}g`)
      .join(', ');
    lines.push(`    other measures: ${others}`);
  }
  for (const note of c.notes) lines.push(`    ! ${note}`);
  return lines.join('\n');
}

export const CHECK_FOOD_SOURCES: RetrievalFunction = {
  name: 'check_food_sources',
  description:
    'Asks every food database at once — their saved foods, the shared corpus, USDA — and hands back what each one said, unranked and including where they disagree, so you judge which to trust. Use when a food is unfamiliar or its numbers matter; for a quick fact use get_nutrition. Pass {"q": "shallots"}; add {"measure": "1 cup"} to price it at a measure they named, {"brand": "Chobani"} for a packaged item, {"include_fatsecret": true} only if the free sources came up short, as it is billed.',
  domains: ['nutrition', 'foods'],

  async run(userId, params) {
    const q = typeof params?.q === 'string' ? params.q.trim() : '';
    if (!q) return null;
    return fanOutFoodSources(userId, {
      query: q,
      brand: typeof params?.brand === 'string' ? params.brand : null,
      measure: typeof params?.measure === 'string' ? params.measure : null,
      includeFatSecret: params?.include_fatsecret === true,
    });
  },

  render(result) {
    /**
     * `undefined` and `null` are DIFFERENT ANSWERS here and collapsing them was a live bug.
     *
     * `executeCalls` logs a throwing `run` to the console and leaves `results[name]` unset, so a
     * crashed lookup arrives as `undefined` — and returning the usage hint for it told the Coach
     * she had passed bad arguments when in fact the search had broken. That is the
     * error-wearing-the-clothes-of-something-else shape `tool-response.ts` exists to prevent, and
     * the layer above already guards a throwing RENDER; this defeated it for a throwing RUN.
     *
     * `null` is the honest usage case: `run` returns it when no query was given.
     */
    if (result === undefined) return toolFaultText('The food databases');
    if (result === null) return 'Food sources: pass q (the food name).';
    const r = result as FanOutResult;

    const trace = ['Sources checked:', ...r.sources_checked.map(checkLine)].join('\n');

    if (r.candidates.length === 0) {
      /**
       * An empty fan-out is a REAL answer and must not read as a fault: it is the evidence that
       * earns the expensive rung. Saying what to do next is the point — nothing else in her context
       * tells her the web lookup exists for exactly this.
       */
      return (
        `No source has "${r.query}"${r.brand ? ` from ${r.brand}` : ''} on file.\n${trace}\n` +
        'Every free source came up empty, which is what the web lookup is for — research it, or ask ' +
        'them what was in it and estimate from the parts.'
      );
    }

    const shown = r.candidates.slice(0, RENDER_LIMIT);
    const head =
      `${r.candidates.length} record${r.candidates.length === 1 ? '' : 's'} for "${r.query}"` +
      (r.requested_measure ? `, priced at ${r.requested_measure} where the source offers it` : '') +
      ':';

    const body = shown.map(candidateBlock).join('\n');
    const more =
      r.candidates.length > shown.length
        ? `\n(${r.candidates.length - shown.length} more not shown — narrow the query if none of these is right.)`
        : '';
    const conflicts = r.disagreements.length
      ? `\n\nWhere they disagree:\n${r.disagreements.map((d) => `- ${d}`).join('\n')}`
      : '';

    return `${head}\n${body}${more}${conflicts}\n\n${trace}`;
  },

  rows(result) {
    return result ? (result as FanOutResult).candidates.length : 0;
  },
};
