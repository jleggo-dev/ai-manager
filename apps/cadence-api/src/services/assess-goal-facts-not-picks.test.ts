/**
 * Owner ruling (2026-09-03, "facts, not picks"): a job prompt carries FACTS, DEFINITIONS, the
 * safety and consent boundaries, and the output contract — never what to prefer, how many, which
 * kind, when, or what to say. A goal read is a judgement she makes and says plainly; the prompt does not fix the number of milestones or the tone of the verdict.
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

const job = config.jobs.find((j) => j.slug === 'assess-goal');

describe('assess-goal — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('AG-1 — no milestone count', () => {
    expect(template).not.toContain('2-4 stepping-stones');
    expect(template).toContain('milestones: stepping-stones that ladder to the goal');
  });

  it('AG-2 — checkable is defined, not exemplified with running', () => {
    expect(template).not.toContain('run a continuous 8k');
    expect(template).not.toContain('a 60-min zone-2 effort');
    expect(template).toContain('on the date they can say yes or no to whether it happened');
  });

  it('AG-3 — no prescribed tone for the read', () => {
    expect(template).not.toContain('never discouraging, never a rubber stamp');
    expect(template).toContain('then say plainly what you make of it.');
  });
});
