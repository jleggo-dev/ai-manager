/**
 * Owner ruling (2026-09-03, "facts, not picks"): a job prompt carries FACTS, DEFINITIONS, the
 * safety and consent boundaries, and the output contract — never what to prefer, how many, which
 * kind, when, or what to say. The edit grammar states what each shape does; how many edits an ask deserves is hers.
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

const job = config.jobs.find((j) => j.slug === 'evolve-plan');

describe('evolve-plan — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('EP-1 — a rebuild is described by its cost, not rationed', () => {
    expect(template).not.toContain('Use this rarely; nearly every adjustment is edits.');
    expect(template).toContain('A rebuild replaces the whole week and the person waits for it.');
  });

  it('EP-2 — no edit count for a small ask', () => {
    expect(template).not.toContain('is ONE rework edit, maybe two');
    expect(template).toContain(
      'each edit you emit is applied; commitments you do not name are left exactly as they are',
    );
  });
});
