/**
 * `research_food` — the web-grounded rung as a tool she can spend, not only a background job
 * (MP27, FOOD-ENGINE.md §7).
 *
 * `researchFoodOutcome` (food-research.ts — owned by a different parcel this wave; read, not
 * edited, here) already exists and already runs from `meal-enrich.ts` in the background AFTER a
 * meal lands, but nothing let her reach it DURING a conversation. The meal-prep scenario needs
 * exactly that: a named vendor ("the wild mushroom co") the free sources will not have, asked for
 * by name, mid-turn, because a photo of the label is sitting right there and the number matters
 * enough to wait for.
 *
 * EXPENSIVE ON PURPOSE, AND SAID SO IN THE DESCRIPTION. This is a live web search with a
 * 240-second budget — food-research.ts's own comment calls it "the most expensive rung, seconds of
 * a person's attention." It exists for the case the cheap sources cannot solve, never as a first
 * move — the description below says exactly that, because a tool this slow needs to teach restraint
 * as loudly as it teaches use.
 *
 * WHAT THIS DOES NOT DO: save anything. A hit here is a FACT — a name, macros, a source URL — for
 * her to relay or reuse. The row only becomes real, reusable food when something pins it, and
 * pinning is outside this parcel's files (the pricing pipeline and recipe capture each do it on
 * their own path). This tool's return text says so, so it never claims a save it did not make.
 */
import { researchFoodOutcome, type ResearchOutcome } from '../food-research.ts';
import { toolFaultText } from '../tool-response.ts';
import type { RetrievalFunction } from './types.ts';

function nutrientLine(n: Record<string, unknown>): string {
  const parts: string[] = [];
  const push = (key: string, label: string, dp: number): void => {
    const v = n[key];
    if (typeof v === 'number') parts.push(`${v.toFixed(dp)} ${label}`);
  };
  push('kcal', 'kcal', 0);
  push('protein_g', 'protein', 1);
  push('carbs_g', 'carbs', 1);
  push('fat_g', 'fat', 1);
  push('fiber_g', 'fibre', 1);
  push('sodium_mg', 'sodium mg', 0);
  return parts.join(' · ') || 'no numbers on this record';
}

export const RESEARCH_FOOD: RetrievalFunction = {
  name: 'research_food',
  description:
    'Looks a NAMED product up on the open web when your sources have nothing — a specific vendor/brand, not a generic ingredient. SLOW (minutes) and billed. Use only after check_food_sources or lookup_food came up empty AND they named who makes it ("the wild mushroom co", "Kirkland Signature") — never for shallots or anything sold generically. Pass {"name": "mixed dried mushrooms"}; add {"brand": "the wild mushroom co"} when they named who makes it, omit it only if nobody did.',
  domains: ['nutrition', 'foods'],

  async run(userId, params) {
    const name = typeof params?.name === 'string' ? params.name.trim() : '';
    if (!name) return null;
    const brand = typeof params?.brand === 'string' && params.brand.trim() ? params.brand.trim() : null;
    return researchFoodOutcome(userId, { name, brand });
  },

  render(result) {
    if (result === undefined) return toolFaultText('That lookup');
    if (result === null) return 'Research a food: pass name (what it is), and brand when they named who makes it.';
    const r = result as ResearchOutcome;
    if (!r.result) {
      return `No usable result — ${r.reason}. Do not invent numbers for it: ask them to read the label, or log it without precise numbers rather than guessing.`;
    }
    const { food, source_url } = r.result;
    const title = [food.brand, food.name].filter(Boolean).join(' ');
    const per = food.base_unit === 'item' ? '1 item' : `100${food.base_unit}`;
    const nutrients = nutrientLine(food.macros_per_base as unknown as Record<string, unknown>);
    const servingBasis = food.base_unit === 'item' ? 1 : 100;
    const stated = food.servings.find((s) => s.amount_g !== servingBasis);
    const servingLine = stated ? ` Also stated per ${stated.label}.` : '';
    const confidence = typeof food.confidence === 'number' ? food.confidence.toFixed(2) : 'unknown';
    return [
      `Found: ${title} — per ${per}: ${nutrients}.${servingLine}`,
      `Confidence ${confidence}.${source_url ? ` Source: ${source_url}.` : ''}`,
      'This is a fact, not a saved food — nothing was written down. Relay the numbers yourself, or use ' +
        'them when logging or building a recipe; they are not applied to anything automatically.',
    ].join('\n');
  },

  rows(result) {
    return result && (result as ResearchOutcome).result ? 1 : 0;
  },
};
