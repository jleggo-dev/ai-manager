/**
 * Owner ruling ("facts, not picks"): a prompt carries facts, definitions, safety boundaries and
 * the output contract — never what to prefer, how many, which kind, when, or what to say.
 *
 * estimate-food decided the measure a food would be logged in forever from a generic notion of
 * what "people actually log", rather than from what this person said; and it told the coach that
 * a rough figure always beats a blank, one sentence before telling her to include only what she
 * has a real basis for. The schema constraint (exactly one serving) is the fact underneath.
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

const job = config.jobs.find((j) => j.slug === 'estimate-food');

describe('estimate-food — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('EF-1: the serving comes from what they said, not from what people generally log', () => {
    expect(template).not.toContain('Pick ONE sensible canonical serving people actually log');
    expect(template).toContain('The schema holds exactly ONE serving');
    expect(template).toContain('use the measure <food_text> states');
  });

  it('EF-2: an estimate is no longer declared better than an omission', () => {
    expect(template).not.toContain('a rough figure someone can act on beats a blank');
    expect(template).toContain('The number on a package is an approximation as well.');
  });

  it('keeps the rule that contradicted it: only what she has a real basis for', () => {
    expect(template).toContain('Include ONLY what you have a real basis for');
  });
});
