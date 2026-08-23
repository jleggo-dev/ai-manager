/**
 * `resolve_portion` — the measure a food does not carry, found once and kept.
 *
 * This is the tool `check_food_sources` points at when a source has the food but not the measure,
 * and the note it prints there would be a lie without this. Owner's case: USDA has shallots by
 * weight, the person said "1/4 cup", and the app must neither guess a density nor give up.
 *
 * It returns GRAMS. Not calories, not a priced portion — grams, which `priceFood` then scales the
 * food's own numbers by. That split is the harness principle in one function: the model supplies the
 * fact it is good at, the store does the arithmetic it is good at.
 *
 * A resolved measure is written back onto the food, so the second time anyone asks it is free. The
 * response says which of those two happened, because "I already knew this" and "I just bought this"
 * are different facts and she should be able to tell the user either.
 */
import { resolvePortion, type PortionOutcome } from '../portion-resolve.ts';
import type { RetrievalFunction } from './types.ts';

const round = (n: number): number => Math.round(n * 10) / 10;

export const RESOLVE_PORTION: RetrievalFunction = {
  name: 'resolve_portion',
  description:
    'Works out what a household measure of one saved food weighs in grams — "1/4 cup", "3 shallots", "1 tbsp chopped" — when the food only lists weights. Use it after check_food_sources says a source has no such measure, so you can price what they actually ate instead of assuming. It returns grams only; the app does the nutrition arithmetic from that. Needs the food it belongs to: pass {"food_id": "...", "measure": "1/4 cup"}. A measure found this way is saved onto that food, so asking again later is free.',
  domains: ['nutrition', 'foods'],

  async run(userId, params) {
    const foodId = typeof params?.food_id === 'string' ? params.food_id.trim() : '';
    const measure = typeof params?.measure === 'string' ? params.measure.trim() : '';
    if (!foodId || !measure) return null;
    return resolvePortion(userId, { foodId, measure });
  },

  render(result) {
    if (!result) return 'Portion lookup: pass food_id (from check_food_sources) and measure ("1/4 cup").';
    const r = result as PortionOutcome;
    const food = r.food ? [r.food.brand, r.food.name].filter(Boolean).join(' ') : 'that food';

    switch (r.status) {
      case 'known':
        return `${r.measure} of ${food} is ${round(r.grams)} g — already on file, nothing looked up.`;
      case 'already_mass':
        return `${r.measure} is a weight already: ${round(r.grams)} g of ${food}. No conversion needed.`;
      case 'looked_up':
        return (
          `${r.measure} of ${food} is ${round(r.grams)} g.` +
          (r.basis ? ` ${r.basis}` : '') +
          (r.stored
            ? ' Saved onto that food, so this is free from now on.'
            : ' Could not save it to the food, so this may need looking up again.')
        );
      case 'unresolved':
        /**
         * A refusal must not read as an absence. "I could not convert that" and "I converted it and
         * the number was impossible" are different facts, and the second one is the more useful:
         * it tells her the food is fine and only the unit is unresolved, so asking the user for a
         * weight is the right next move rather than doubting the food.
         */
        return (
          `Could not settle what ${r.measure} of ${food} weighs — ${r.reason}. ` +
          'Do not invent a weight. Ask them what it weighed, or log it in a measure the food already lists.'
        );
    }
  },

  rows(result) {
    return result && (result as PortionOutcome).status !== 'unresolved' ? 1 : 0;
  },
};
