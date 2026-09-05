/**
 * Owner ruling ("facts, not picks"): a prompt carries facts, definitions, safety boundaries and
 * the output contract — never what to prefer, how many, which kind, when, or what to say.
 *
 * generate-recipe decided the size of the answer ("prefer 2"), the ambition of every dish
 * ("weeknight-simple"), how many people are eating ("usually 1-4"), recipe complexity by a step
 * floor ("2-6"), how seriously to take the person's own macro targets, and which of their
 * ingredients are foreground. The HARD SAFETY block is a boundary and stays untouched.
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

const job = config.jobs.find((j) => j.slug === 'generate-recipe');

describe('generate-recipe — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('GR-1: names the cap, not the good number', () => {
    expect(template).not.toContain('prefer 2 when the list supports variety');
    expect(template).not.toContain('Return 1–3 recipes');
    expect(template).toContain('Return at most 3 recipes.');
  });

  it('GR-2: does not set the ambition of every dish', () => {
    expect(template).not.toContain('Keep them weeknight-simple');
  });

  it('GR-3: servings is defined, not guessed at for her', () => {
    expect(template).not.toContain('realistic batch size (usually 1–4)');
    expect(template).toContain('servings: how many portions this batch makes.');
  });

  it('GR-4: no step floor or ceiling standing in for complexity', () => {
    expect(template).not.toContain('2–6 short cook steps');
    expect(template).toContain('steps: the cook steps.');
  });

  it('GR-5: their own macro targets are not something to weigh lightly', () => {
    expect(template).not.toContain('bias toward fitting their day lightly');
    expect(template).toContain('<targets> is optional: what remains of their daily macro targets');
  });

  it('GR-6: does not decide which of their foods are the stars', () => {
    expect(template).not.toContain('Prefer foods from their list as the stars of the dish');
    expect(template).toContain('Ground EVERY dish in <ingredients>');
  });

  it('keeps the safety boundary untouched', () => {
    expect(template).toContain('HARD SAFETY: never include anything in <allergies>');
  });
});
