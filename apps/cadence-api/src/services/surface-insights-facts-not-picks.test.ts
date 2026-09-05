/**
 * Owner ruling ("facts, not picks"): a prompt carries facts, definitions, safety boundaries and
 * the output contract — never what to prefer, how many, which kind, when, or what to say.
 *
 * surface-insights is five lines long, and five running examples were the only guidance in it —
 * so they functioned as the taxonomy of "notable". The three types are now defined instead. The
 * no-streak-shame boundary stays.
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

const job = config.jobs.find((j) => j.slug === 'surface-insights');

describe('surface-insights — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('SI-1: defines the three types instead of listing five running artefacts', () => {
    expect(template).not.toContain('a shoe near end-of-life');
    expect(template).not.toContain('a run of consistent daily entries worth celebrating');
    expect(template).not.toContain('Examples:');
    expect(template).toContain('win is something that went well');
    expect(template).toContain('risk is something heading somewhere bad');
    expect(template).toContain('nudge is something worth doing soon');
  });

  it('keeps the boundary that is a rule: no streak shame', () => {
    expect(template).toContain('Never frame a missed day as a failure or a reset to zero');
  });
});
