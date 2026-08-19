import { logMeal, isMeal } from './nutrition.ts';
import { logWater } from './water.ts';
import type { CoachActionTool } from './coach-action-types.ts';
import type { MealKind } from '@cadence/shared';

/**
 * `log_nutrition` — the coach's hand for food and water, in its own file per the
 * `update_constraint` precedent (coach-actions.ts sits against the 500-line gate).
 *
 * One tool, a small menu of variables (owner directive 2026-08-19: "nutrition is a tool that can
 * be called with a few different kinds of variables") — the same consolidation shape as the
 * `get_nutrition` read facade, so food stays two easy choices instead of many hard ones.
 *
 * Two write semantics, on purpose, and they follow the house doctrine (coach-actions.ts header):
 *  - **Water applies on the spot.** The user stated the amount; there is no estimate to vet, so a
 *    confirm card would be friction pretending to be safety. One legible fact, said back out loud.
 *  - **A meal lands pending.** The words are theirs but the NUMBERS are a parse — and the food
 *    module's provisional-until-confirmed stance is non-negotiable: nothing the user has not
 *    tapped may count. `alwaysProvisional` makes that structural rather than instructed — the
 *    meal is listed on their day, outside the totals, one ✓ away on the Food home.
 *
 * The chat's own confirm sheet (coach-food-classify → CoachFoodActionSheet) keeps first claim on
 * a meal the user just typed: when it fires, the turn context says so, and the description tells
 * her to stand down. This tool is for the food that arrives sideways — remembered meals, water
 * after a run — which the sheet never catches.
 */
export const LOG_NUTRITION: CoachActionTool = {
  name: 'log_nutrition',
  description:
    'Write down something the user ate or drank, from the conversation. Use it when food or water comes up sideways — a meal they remember eating earlier, water after a session — and NOT for a meal in the message they just sent when the app is already showing them a confirm sheet for it (the turn context tells you when it is). Water takes effect immediately: pass the amount they stated, {"water_ml": 500} — a glass is about 250, 8 oz about 240. A meal does NOT: pass their words, {"text": "two eggs and sourdough toast", "meal": "breakfast"} and it lists on their day with estimated numbers, counting only once they tap it on their Food home — so say the numbers back and point them there. Words or "water_ml", never both in one call.',
  parameters: {
    properties: {
      text: {
        type: 'string',
        description:
          'What they ate, in their own words — keep any amounts they said. Required unless "water_ml" is given instead.',
      },
      meal: {
        type: 'string',
        enum: ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other'],
        description: 'Which meal it belongs to, when they said or implied it. Omit to let the time of day decide.',
      },
      water_ml: {
        type: 'integer',
        description:
          'Water they drank, in millilitres — convert what they said (a glass ≈ 250, 8 oz ≈ 240). Counts immediately. Omit when logging food.',
      },
    },
  },
  async run(userId, params) {
    const text = String(params.text ?? '').trim();
    const water =
      typeof params.water_ml === 'number' && Number.isFinite(params.water_ml) ? Math.round(params.water_ml) : null;

    if (water != null && text) {
      return 'One thing per call — words for food OR water_ml for water, not both. Nothing was written down; call it once for each.';
    }

    if (water != null) {
      if (water < 1 || water > 5000) {
        return 'That amount does not look like one drink (it must be 1–5000 ml). Nothing was written down — check the number and try again.';
      }
      try {
        const r = await logWater(userId, water);
        return [
          `Water logged: ${water} ml — their day now reads ${(r.water_ml / 1000).toFixed(1)} L.`,
          'Say it back in a few words and carry on — no confirmation is needed for water.',
        ].join('\n');
      } catch {
        return 'The water could not be written down just now — nothing was logged. Tell them plainly and offer to try again in a moment.';
      }
    }

    if (!text) {
      return 'Nothing to log was given. Pass their words for a meal, or water_ml for water — nothing was written down.';
    }

    const meal: MealKind | undefined = isMeal(params.meal) ? params.meal : undefined;
    try {
      const row = await logMeal(userId, { text: text.slice(0, 500), meal, alwaysProvisional: true });
      if (!row.macros || row.macros.kcal == null) {
        return [
          `Wrote it down for ${row.meal}, exactly in their words — the numbers could not be worked out this time, so nothing counts yet.`,
          'Tell them it is noted, and that you can firm the numbers up together whenever they like.',
        ].join('\n');
      }
      const names = row.items
        .map((i) => i.name)
        .filter(Boolean)
        .slice(0, 4)
        .join(', ');
      const protein = row.macros.protein_g;
      return [
        `Pending on their ${row.meal}: ${names || text.slice(0, 60)} — about ${Math.round(row.macros.kcal)} kcal${
          typeof protein === 'number' ? `, ${Math.round(protein)}g protein` : ''
        }. It is listed on their day and does NOT count until they tap the ✓ on their Food home.`,
        'Say the read back in one short line, and point at the ✓ if they want it counted now.',
      ].join('\n');
    } catch {
      return 'That meal could not be written down just now — nothing was logged. Tell them plainly and offer to try again in a moment.';
    }
  },
};
