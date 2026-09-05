/**
 * Owner ruling ("facts, not picks"): a prompt carries facts, definitions, safety boundaries and
 * the output contract — never what to prefer, how many, which kind, when, or what to say.
 *
 * research-food's answers are pinned permanently, so a silent pick is a lasting one. RF-1 (landed
 * in an earlier PR) made the runner-up products visible in `alternates` so the coach can ask
 * which one they ate. RF-2 removes the worked example that planted two named answers for one
 * query, and states the retailer fact plainly instead.
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
  jobs: Array<{
    slug: string;
    config: { promptTemplate: string; expectedSchema?: { fields?: Record<string, unknown> } };
  }>;
};

const job = config.jobs.find((j) => j.slug === 'research-food');

describe('research-food — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('RF-1: the runners-up come back instead of being silently discarded', () => {
    expect(template).not.toContain('pick the most widely distributed one and lower confidence accordingly');
    expect(template).toContain('list the other names you considered in "alternates"');
    expect(template).toContain('"alternates": string[]');
    expect(job?.config.expectedSchema?.fields).toHaveProperty('alternates');
  });

  it('RF-2: plants no named answer for the worked example query', () => {
    expect(template).not.toContain('dill pickle peanuts at Couche-Tard');
    expect(template).not.toContain('The Carolina Nut Co.');
    expect(template).toContain('convenience stores sell both third-party brands and their own house brands');
  });

  it('keeps the arithmetic contract between the two nutrition views', () => {
    expect(template).toContain('These two views MUST agree');
  });
});
