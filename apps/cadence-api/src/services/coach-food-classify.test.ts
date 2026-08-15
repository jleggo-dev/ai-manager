import { describe, it, expect } from 'vitest';
import {
  classifyFoodIntent,
  extractLogQuery,
  mergeDietaryProposal,
  parseUsualMeal,
  proposeDietaryPatch,
  recipeTextFromWindow,
} from './coach-food-classify.ts';

describe('classifyFoodIntent', () => {
  it('detects usual breakfast as log_food', () => {
    const c = classifyFoodIntent('I had my usual breakfast');
    expect(c?.kind).toBe('log_food');
    if (c?.kind === 'log_food') {
      expect(c.usualMeal).toBe('breakfast');
      expect(c.mealHint).toBe('breakfast');
      expect(c.query).toBe('breakfast');
    }
  });

  it('detects I ate / I had food phrases', () => {
    const c = classifyFoodIntent('I ate 3 eggs and toast');
    expect(c?.kind).toBe('log_food');
    if (c?.kind === 'log_food') expect(c.query).toMatch(/eggs/);
  });

  it('does not treat goal-setting as a log', () => {
    expect(classifyFoodIntent('I want to eat better')).toBeNull();
    expect(classifyFoodIntent('I want to have more energy')).toBeNull();
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

describe('extractLogQuery / parseUsualMeal', () => {
  it('strips lead-ins', () => {
    expect(extractLogQuery('I just had greek yogurt')).toBe('greek yogurt');
    expect(extractLogQuery('log my lunch')).toBe('lunch');
  });

  it('parses usual meal', () => {
    expect(parseUsualMeal('my usual dinner')).toBe('dinner');
    expect(parseUsualMeal('eggs')).toBeUndefined();
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
 * Regression: the worst false positive we have shipped. Reported from the device — the user was
 * talking about Spartan races, and a confirm sheet appeared offering to log "1 beast" for
 * breakfast at ~2000 kcal.
 *
 * `had` is an auxiliary verb far more often than it is eating. These are all sentences a coaching
 * conversation produces constantly, and none of them is a meal.
 */
describe('"had" is usually not eating', () => {
  const notMeals = [
    'I do at least one beast a year, but I had to skip it this year',
    'I had to skip my run yesterday',
    'I had been running consistently until October',
    'I had a rough week at work',
    'I had a long day and did not get out',
    'I had enough of the treadmill',
  ];
  for (const line of notMeals) {
    it(`does not offer to log: "${line}"`, () => {
      expect(classifyFoodIntent(line)).toBeNull();
    });
  }

  /** The guard must not cost us the real thing. */
  const meals = [
    'I had eggs and toast',
    'I had a chicken salad for lunch',
    'just ate a banana',
    'I had my usual breakfast',
  ];
  for (const line of meals) {
    it(`still catches: "${line}"`, () => {
      expect(classifyFoodIntent(line)?.kind).toBe('log_food');
    });
  }
});

/**
 * The turns that must NOT open a food sheet — each one a real message that did.
 *
 * A wrong draft here is expensive in a way a missed one is not: the sheet interrupts a
 * conversation to ask someone to affirm something absurd, which is how confirm-first loses trust
 * instead of earning it. So the bias is silence when the only evidence is the word "had".
 */
describe('classifyFoodIntent — what is not a meal', () => {
  const notFood = (msg: string) => expect(classifyFoodIntent(msg)?.kind).not.toBe('log_food');

  it('does not price a training report as a food', () => {
    // Observed on device 2026-08-15: this reached estimate-food, which returned
    // {"name":"That last run","serving_label":"1 run"}. The old guard listed adjectives right
    // after "had a", so the adverb in "a really hard time" walked straight past it.
    notFood('That last run was good but I had a really hard time keeping my Hr in zone 2 (except for walking).');
  });

  it('survives the modifier that broke the last version', () => {
    notFood('I had a really hard time today');
    notFood('I had an absolutely brutal week');
    notFood('I had a pretty rough night');
  });

  it('still refuses the Spartan Beast', () => {
    notFood('I do at least one beast a year, but I had to skip it this year');
  });

  it('ignores auxiliary "had" in ordinary talk', () => {
    notFood('I had been running before the knee went');
    notFood('I had enough of the treadmill');
    notFood("I've had a look at the plan");
    notFood('I had a chat with my physio about the elbow');
  });

  it('does not fire on sleep, mood or injury talk', () => {
    notFood('I had a terrible sleep and my shoulder is sore');
    notFood('Had a stressful day, skipped my session');
  });
});

describe('classifyFoodIntent — what IS a meal', () => {
  const isFood = (msg: string) => expect(classifyFoodIntent(msg)?.kind).toBe('log_food');

  it('reads the specific verbs without help', () => {
    isFood('I ate a burrito');
    isFood('just drank a protein shake');
  });

  it('reads a meal word even inside a busy sentence', () => {
    // The activity veto must not swallow a real log that happens to mention training.
    isFood('after my run I had breakfast');
    isFood('I had a coffee before the session');
  });

  it('reads a plain "had" when nothing contradicts it', () => {
    isFood('I had a burrito');
    isFood('I had two eggs and toast');
  });
});
