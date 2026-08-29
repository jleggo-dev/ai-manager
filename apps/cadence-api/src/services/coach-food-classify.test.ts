import { describe, it, expect } from 'vitest';
import {
  classifyFoodIntent,
  mergeDietaryProposal,
  proposeDietaryPatch,
  recipeTextFromWindow,
} from './coach-food-classify.ts';

describe('classifyFoodIntent', () => {
  it('does not treat goal-setting or a plain meal as anything — she has real tools for that now', () => {
    // MP21/MP40: a plain meal is no longer classified here at all. "I ate 3 eggs" used to come
    // back `kind: 'log_food'`; now it is null, exactly like any other ordinary turn, because
    // preview_meal/log_meal are tools she calls herself rather than a regex deciding for her.
    expect(classifyFoodIntent('I want to eat better')).toBeNull();
    expect(classifyFoodIntent('I ate 3 eggs and toast')).toBeNull();
    expect(classifyFoodIntent('I had a chicken salad for lunch')).toBeNull();
    expect(classifyFoodIntent('I had my usual breakfast')).toBeNull();
  });

  it('detects save as recipe', () => {
    const c = classifyFoodIntent('save that as a recipe');
    expect(c?.kind).toBe('save_recipe');
    if (c?.kind === 'save_recipe') expect(c.needsWindow).toBe(true);
  });

  it('detects I made … serves N as save_recipe', () => {
    const c = classifyFoodIntent('I made chili with 500g beef and beans, serves 6');
    expect(c?.kind).toBe('save_recipe');
    if (c?.kind === 'save_recipe') {
      expect(c.needsWindow).toBe(false);
      expect(c.recipeText).toMatch(/chili/);
    }
  });

  /**
   * MP6 (FOOD-ENGINE.md) — the meal-prep scenario's own message, which the OLD gate never caught:
   * no literal "I made" (it says "Made the mushroom sauce"), and "Yields 3 cups" is not the
   * "makes N" / "serves N" the old pattern demanded. Reproduced at reduced length.
   */
  it('catches the meal-prep scenario: a cooking verb plus an ingredient list, no "serves N"', () => {
    const turn = [
      'Doing my weekend prep for meals this week - going to make pork chops with mushroom sauce.',
      'Made the mushroom sauce:',
      '',
      '**Mushroom sauce**',
      '- 680g button mushrooms',
      '- 500 ml evaporated milk, no name brand',
      '- 1 tbsp black pepper',
      '- 1/2 tsp salt',
      '- 1/2 tsp xanthan gum',
      '- 1 tbsp chopped rosemary',
      '- 1 tbsp chopped tarragon',
      '- 3 shallots',
      '- 2 green onions',
      '- 1 tbsp collagen (organika)',
      '- 15 pieces of mixed dried mushroom from "the wild mushroom co"',
      '',
      'Yields 3 cups of sauce',
    ].join('\n');
    expect(classifyFoodIntent(turn)?.kind).toBe('save_recipe');
  });

  it('catches a stated yield even with a short ingredient list', () => {
    const turn = ['Prepped a quick dressing:', '- 2 tbsp olive oil', '- 1 tbsp vinegar', 'Makes 1/4 cup'].join('\n');
    expect(classifyFoodIntent(turn)?.kind).toBe('save_recipe');
  });

  it('does not read a workout report as a recipe', () => {
    // The shape that made the ingredient-list heuristic worth guarding: a rep scheme is also
    // "several lines starting with a number", and "made it through leg day" contains "made".
    const turn = ['Made it through leg day:', '3x10 squats', '3x10 lunges', '3x10 leg press'].join('\n');
    expect(classifyFoodIntent(turn)).toBeNull();
  });

  it('does not read an ordinary "made" sentence as a recipe with no yield or list', () => {
    expect(classifyFoodIntent('I made a mistake booking the gym, sorted now')).toBeNull();
    expect(classifyFoodIntent('made it to the session on time for once')).toBeNull();
  });

  it('detects dietary allergies and diet labels', () => {
    const a = classifyFoodIntent("I'm allergic to peanuts and shellfish");
    expect(a?.kind).toBe('dietary_update');
    if (a?.kind === 'dietary_update') {
      expect(a.patch.allergies).toEqual(expect.arrayContaining(['peanuts', 'shellfish']));
    }
    const v = classifyFoodIntent("I'm vegan");
    expect(v?.kind).toBe('dietary_update');
    if (v?.kind === 'dietary_update') expect(v.patch.diet).toBe('vegan');
  });

  it('detects dislikes', () => {
    const c = classifyFoodIntent('I dislike cilantro');
    expect(c?.kind).toBe('dietary_update');
    if (c?.kind === 'dietary_update') expect(c.patch.dislikes).toContain('cilantro');
  });
});

describe('dietary merge + recipe window', () => {
  it('merges allergies without wiping diet', () => {
    const proposed = mergeDietaryProposal(
      { allergies: ['dairy'], diet: 'vegetarian', dislikes: [], notes: null },
      { allergies: ['Peanuts'] },
    );
    expect(proposed.allergies).toEqual(expect.arrayContaining(['dairy', 'peanuts']));
    expect(proposed.diet).toBe('vegetarian');
  });

  it('proposeDietaryPatch is empty for unrelated chatter', () => {
    expect(proposeDietaryPatch('how is my plan looking?')).toEqual({});
  });

  it('recipeTextFromWindow prefers an I made line', () => {
    const w = ['User: I made chili with beef, serves 6', 'Coach: nice', 'User: save that as a recipe'].join('\n');
    expect(recipeTextFromWindow(w, 'save that as a recipe')).toMatch(/chili/);
  });
});

/**
 * Someone else's meal must still not read as a recipe or a dietary change — the classifier's only
 * remaining jobs. The first-person guard that used to protect log_food is gone WITH log_food; what
 * is left here is checking the two surviving kinds stay silent on ordinary third-person chatter.
 */
describe('ordinary chatter about other people stays silent', () => {
  const notFood = [
    'Thank you. Can we clean the plan up though? My son is okay he just had a bead stuck in his ear.',
    'my daughter had a rough night',
    'she had surgery on Tuesday so I am on kid duty',
  ];
  for (const line of notFood) {
    it(`classifies nothing for: "${line.slice(0, 52)}…"`, () => {
      expect(classifyFoodIntent(line)).toBeNull();
    });
  }
});
