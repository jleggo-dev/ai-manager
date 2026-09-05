/**
 * Owner ruling ("facts, not picks"): a prompt carries facts, definitions, safety boundaries and
 * the output contract — never what to prefer, how many, which kind, when, or what to say.
 *
 * progress-layout-compose ordered the page from a two-bucket reading of the user's own words
 * ("put a non-temporal kind FIRST"). What the catalog marks is a fact; where it goes on the page
 * is hers. The "history" rule stays because it is the contract progress-layout-validate.ts
 * actually enforces — so it is now stated as the app's rejection, not as a preference.
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

const job = config.jobs.find((j) => j.slug === 'progress-layout-compose');

describe('progress-layout-compose — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('PL-1: defines temporal vs non-temporal instead of dictating page order from it', () => {
    expect(template).not.toContain('put a kind <catalog> marks non-temporal FIRST');
    expect(template).not.toContain('When their framing is not about a timeline or a trend');
    expect(template).toContain('<catalog> marks each kind temporal or non-temporal');
    expect(template).toContain('order the sections to match it');
  });

  it('PL-2: states the history rule as the contract the validator enforces', () => {
    expect(template).not.toContain('"history", if you include it, is ALWAYS the very last section');
    expect(template).toContain('"history" is allowed at most once and only as the last section');
    expect(template).toContain('the app rejects a layout that repeats it or places it anywhere else');
  });
});
