/**
 * Owner ruling ("facts, not picks"): a prompt carries facts, definitions, safety boundaries and
 * the output contract — never what to prefer, how many, which kind, when, or what to say.
 *
 * SR-1 landed in an earlier PR: "some onion" used to become a number the app could not tell from
 * a real one. It is null now, and the app can ask. This test only pins that, so a config
 * regeneration cannot quietly put the invented quantity back.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  jobs: Array<{
    slug: string;
    config: {
      promptTemplate: string;
      expectedSchema?: {
        fields?: { ingredients?: { items?: { fields?: { qty?: { nullable?: boolean } } } } };
      };
    };
  }>;
};

const job = config.jobs.find((j) => j.slug === 'structure-recipe');

describe('structure-recipe — a vague amount is marked, not invented', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('SR-1: never picks a reasonable qty for an amount the recipe did not state', () => {
    expect(template).not.toContain('pick one reasonable qty/unit and keep the ingredient');
    expect(template).toContain('keep the ingredient and set qty to null so the app can ask');
    expect(template).toContain('"qty": number | null');
  });

  it('SR-1: the declared schema allows the null', () => {
    expect(job?.config.expectedSchema?.fields?.ingredients?.items?.fields?.qty?.nullable).toBe(true);
  });
});
