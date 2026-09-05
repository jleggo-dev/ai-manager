/**
 * Owner ruling ("facts, not picks"): a prompt carries facts, definitions, safety boundaries and
 * the output contract — never what to prefer, how many, which kind, when, or what to say.
 *
 * nutrition-baseline used to decide the SHAPE of every coaching intervention before reading a
 * word of the person's logs: exactly one small change, a lookup table that answered a slow rate
 * with a cut, a fixed ~100-150 kcal step, and a deterministic figure that outranked her reasoning.
 * The safety half stays: too_fast is a real limit, and the pace ceiling is a rule.
 *
 * This test pins the prompt sync-jobs ships, so a prompt edit or a config regeneration that
 * re-issues any of those steers fails CI.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  jobs: Array<{ slug: string; config: { promptTemplate: string } }>;
};

const job = config.jobs.find((j) => j.slug === 'nutrition-baseline');

describe('nutrition-baseline — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('NB-1: never sizes the change for her, or caps how many she may name', () => {
    expect(template).not.toContain('propose exactly ONE small change');
    expect(template).not.toContain('NEVER an overhaul, never more than one change');
    expect(template).not.toContain('ONE small, gradual, concrete change');
    expect(template).toContain('The `suggestion` field holds one suggestion');
    expect(template).toContain('- suggestion: ONE concrete change');
  });

  it('NB-2: never requires the read to contain praise', () => {
    expect(template).not.toContain('name at least one genuinely good thing');
    expect(template).toContain("what's already working.");
  });

  it('NB-3: states what each trend arm MEANS instead of answering it with a lookup table', () => {
    expect(template).not.toContain('"too_slow" -> propose a modest kcal DECREASE');
    expect(template).not.toContain('re-propose the current numbers unchanged');
    expect(template).toContain('"too_fast" means the loss is running faster than the safe pace');
    expect(template).toContain('"too_slow" means slower than that pace; "on_track" means within it');
  });

  it('NB-3: keeps the two things that ARE rules — the too_fast increase and the pace ceiling', () => {
    expect(template).toContain('propose a kcal INCREASE (losing too fast is not the goal - protect muscle)');
    expect(template).toContain('Never propose targets that steer to a pace above weight_trend.safe_kg_per_week');
  });

  it('NB-4: never fixes the magnitude of a target change', () => {
    expect(template).not.toContain('Move a small step (~100-150 kcal)');
    expect(template).not.toContain('keep protein steady or up');
    expect(template).toContain('Never a big swing. Protein is anchored to body weight and training.');
  });

  it('NB-5: the implied-maintenance guard reports, it does not veto her reasoning', () => {
    expect(template).not.toContain('Treat both as given');
    expect(template).not.toContain('do not argue with them');
    expect(template).toContain('The app applies its own floor and a cap on repeated cuts after you');
    expect(template).toContain('If the logs contradict the figure');
  });

  it('NB-6: seeds no specific intervention by example', () => {
    expect(template).not.toContain('add a protein at breakfast a few days a week');
    expect(template).not.toContain('make two of the weeknight beers alcohol-free');
  });
});
