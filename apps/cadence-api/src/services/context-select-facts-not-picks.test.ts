/**
 * Owner ruling (2026-09-03, "facts, not picks"): a job prompt carries FACTS, DEFINITIONS, the
 * safety and consent boundaries, and the output contract — never what to prefer, how many, which
 * kind, when, or what to say. The retriever is told what a call costs, not how many to make.
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

const job = config.jobs.find((j) => j.slug === 'context-select');

describe('context-select — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('CS-1 — no call-count band', () => {
    expect(template).not.toContain('Prefer the FEWEST calls');
    expect(template).not.toContain('usually 0-2');
    expect(template).toContain('each call adds latency before the coach can answer');
  });
});
