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
