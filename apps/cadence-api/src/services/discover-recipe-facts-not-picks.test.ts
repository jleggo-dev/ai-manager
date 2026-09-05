/**
 * Owner ruling ("facts, not picks"): a prompt carries facts, definitions, safety boundaries and
 * the output contract — never what to prefer, how many, which kind, when, or what to say.
 *
 * discover-recipe's only input is a query the person typed, and the prompt overrode it in
 * advance: how many recipes ("prefer 2"), how hard the cooking may be ("weeknight-simple"), how
 * many people are eating ("usually 1-4"), and a step floor. A searched-for dish can be
 * arbitrarily complex; the query is the fact.
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

const job = config.jobs.find((j) => j.slug === 'discover-recipe');

describe('discover-recipe — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('DC-1: names the cap, not the good number or the effort level', () => {
    expect(template).not.toContain('Return 1–3 weeknight-simple recipes (prefer 2)');
    expect(template).not.toContain('weeknight-simple');
    expect(template).toContain('Return at most 3 recipes.');
    expect(template).toContain('Ground ideas in <query>');
  });

  it('DC-2: servings is defined, not guessed at for her', () => {
    expect(template).not.toContain('realistic batch size (usually 1–4)');
    expect(template).toContain('servings: how many portions this recipe makes.');
  });

  it('DC-3: no step floor or ceiling standing in for complexity', () => {
    expect(template).not.toContain('2–6 short cook steps');
    expect(template).toContain('steps: the cook steps.');
  });

  it('keeps the safety boundary untouched', () => {
    expect(template).toContain('HARD SAFETY: never include anything in <allergies>');
  });
});
