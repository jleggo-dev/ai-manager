/**
 * Owner ruling (2026-09-03, "facts, not picks"): a job prompt carries FACTS, DEFINITIONS, the
 * safety and consent boundaries, and the output contract — never what to prefer, how many, which
 * kind, when, or what to say. A tripwire says what happened; which lever answers it is the coach’s to work out.
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

const job = config.jobs.find((j) => j.slug === 'situation-assess');

describe('situation-assess — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('SA-1 — a consistency dip does not order an easier week', () => {
    expect(template).not.toContain('suggested_levers that ease the load');
    expect(template).not.toContain('never add more');
    expect(template).toContain('The counts say what happened, never why');
    expect(template).toContain('the levers are yours');
  });

  it('SA-2 — flat outcome states the fact, and the field is hers to pick', () => {
    expect(template).not.toContain('flat/negative outcome -> recommend_replan with suggested_levers');
    expect(template).toContain('they did the work and the number did not move');
    expect(template).toContain('which of the three fields fits is yours');
  });
});
