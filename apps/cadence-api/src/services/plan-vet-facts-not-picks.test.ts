/**
 * Owner ruling (2026-09-03, "facts, not picks"): a job prompt carries FACTS, DEFINITIONS, the
 * safety and consent boundaries, and the output contract — never what to prefer, how many, which
 * kind, when, or what to say. The verifier reports violations of the safety and constraint boundaries — it does not require a kind of work to be present.
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

const job = config.jobs.find((j) => j.slug === 'plan-vet');

describe('plan-vet — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('PV-1 — a non-physical constraint caps load; it does not mandate restorative work', () => {
    expect(template).not.toContain('restorative work present');
    expect(template).toContain('total weekly load capped, nothing that demands pushing through');
  });

  it('PV-2 — the rest-day violation names the unsafe thing, not the absence of a rest day', () => {
    expect(template).not.toContain('zero rest days across the week');
    expect(template).toContain('seven days of loaded physical training with no easy or rest day');
  });
});
