/**
 * Owner ruling ("facts, not picks"): a prompt carries facts, definitions, safety boundaries and
 * the output contract — never what to prefer, how many, which kind, when, or what to say.
 *
 * sweep-food-recipes had a numeric trigger for batch cooking hard-coded into a FIELD GLOSSARY
 * ("3 or more identical repeats usually means…"), a taste ruling about what is worth saving
 * (coffee plus milk), a specific pairing declared not-a-dish, a cap the app already enforces
 * dressed as a keep rule, and register instructions that belong to the persona.
 *
 * This test pins the prompt sync-jobs ships, so a config regeneration that re-issues them
 * fails CI.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  jobs: Array<{ slug: string; config: { promptTemplate: string } }>;
};

const job = config.jobs.find((j) => j.slug === 'sweep-food-recipes');

describe('sweep-food-recipes — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('SW-1: the field glossary defines identical_meal_days and infers nothing from it', () => {
    expect(template).not.toContain('3 or more identical repeats of a multi-item meal usually means');
    expect(template).toContain('identical_meal_days: days the meal was exactly this set and nothing else.');
  });

  it('SW-2: yield_servings has no numeric trigger', () => {
    expect(template).not.toContain('Set a number greater than 1 only when the evidence says');
    expect(template).not.toContain('identical_meal_days of 3 or more');
    expect(template).toContain('yield_servings: the number of eatings one cooking produced, from the evidence');
  });

  it('SW-3: no ruling on what is too ordinary to save', () => {
    expect(template).not.toContain('too small or too ordinary to be worth a saved row');
    expect(template).not.toContain('coffee plus milk');
  });

  it('SW-4: keeps the mechanical fact and drops the worked example', () => {
    expect(template).not.toContain('a muffin logged beside a smoothie set');
    expect(template).not.toContain('is a passenger, not part of the dish');
    expect(template).toContain('One member is not part of the dish. Members cannot be edited');
  });

  it('SW-5: the cap belongs to the app, and ranking is not decided by seen_count', () => {
    expect(template).not.toContain('Keep at most 3 candidates');
    expect(template).not.toContain('keep the 3 with the highest seen_count');
    expect(template).toContain('Order the proposals best-first. The app shows at most 3 and drops the rest.');
  });

  it('SW-6: register lives in the persona, not the job', () => {
    expect(template).not.toContain('No cheerful or clever names');
    expect(template).not.toContain('No praise, no advice, no exclamation marks');
    expect(template).toContain('one plain sentence for the user that states the counts');
    expect(template).toContain('Max 60 characters.');
  });
});
