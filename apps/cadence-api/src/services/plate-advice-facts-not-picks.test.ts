/**
 * Owner ruling (2026-09-03, "facts, not picks"): a job prompt carries FACTS, DEFINITIONS, the
 * safety and consent boundaries, and the output contract — never what to prefer, how many, which
 * kind, when, or what to say. A plate read states what is on the plate against what is left; the suggestion itself is hers.
 *
 * This pins the prompt in the CONFIG sync-jobs ships, so a prompt edit or a config regeneration
 * that re-issues a removed steer fails CI.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  jobs: Array<{ slug: string; config: { promptTemplate: string; variables?: Array<{ name: string }> } }>;
};

const job = config.jobs.find((j) => j.slug === 'plate-advice');

describe('plate-advice — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('PA-1/PA-2 — no prescribed kind of change', () => {
    expect(template).not.toContain('a portion tweak or swap');
    expect(template).not.toContain('suggest the SMALLEST change');
    expect(template).not.toContain('maybe half the fries');
    expect(template).toContain('give ONE short, concrete, do-it-now note about this plate');
    expect(template).toContain('If it is more than they have left, say what would close the gap');
  });

  it('PA-3 — an empty <remaining> is missing data, not a licence to judge a balanced plate', () => {
    expect(template).not.toContain('judge against a balanced plate, not a number');
    expect(template).toContain('you do not know what room they have left today; say so, and judge against <goal> only');
  });
});
