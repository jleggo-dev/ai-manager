/**
 * Owner ruling ("facts, not picks"): a prompt carries facts, definitions, safety boundaries and
 * the output contract — never what to prefer, how many, which kind, when, or what to say.
 *
 * generate-meal-plan told the coach to repeat what the person had already saved, to take their
 * own macro targets lightly across a whole week, and to guess which staples they "obviously"
 * already own. All three are now stated as facts about the inputs and about what the app does.
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

const job = config.jobs.find((j) => j.slug === 'generate-meal-plan');

describe('generate-meal-plan — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('MP-1: saved recipes are an input, not a preference', () => {
    expect(template).not.toContain('Prefer reusing recipes from <saved_recipes> when they fit');
    expect(template).toContain('<saved_recipes> are recipes this person has saved');
    expect(template).toContain('set reuse_recipe_id to that id');
  });

  it('MP-2: their own daily targets are not something to bias lightly', () => {
    expect(template).not.toContain('optional daily macro context — bias lightly');
    expect(template).toContain('<targets> holds their daily macro targets when they have set any');
    expect(template).toContain('the app computes them from the ingredients');
  });

  it('MP-3: does not decide what the person already owns', () => {
    expect(template).not.toContain('shopping_list should omit staples they already have when obvious');
    expect(template).toContain("shopping_list covers everything the week's meals need");
  });

  it('keeps the safety boundary untouched', () => {
    expect(template).toContain('HARD SAFETY: never include anything in <allergies>');
  });
});
