/**
 * Owner ruling (2026-09-03, "facts, not picks"): a job prompt carries FACTS, DEFINITIONS, the
 * safety and consent boundaries, and the output contract — never what to prefer, how many, which
 * kind, when, or what to say. Extraction records what the user said; it does not cap how many goals, milestones or sentences they are allowed to have.
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

const job = config.jobs.find((j) => j.slug === 'capture-extract');

describe('capture-extract — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('CE-1/CE-2/CE-3 — no counts on goals, milestones or the brief', () => {
    expect(template).not.toContain('Prefer the FEWEST goals');
    expect(template).not.toContain('at most a few');
    expect(template).not.toContain('Two or three plain sentences.');
    expect(template).toContain('Do NOT split one objective into several goals');
  });

  it('CE-4 — no steer about where a weight goal belongs', () => {
    expect(template).not.toContain('weight/body-composition goals usually live here');
    expect(template).toContain('nourishment (food, meals, eating patterns)');
  });
});
