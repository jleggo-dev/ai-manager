/**
 * Owner ruling ("facts, not picks"): a prompt carries facts, definitions, safety boundaries and
 * the output contract — never what to prefer, how many, which kind, when, or what to say.
 *
 * disrupted-plan collapsed four very different episodes (travel, a flare-up, grief, a brutal
 * week) into one word — "light" — and told the coach what register to write in. The boundary
 * that stays is the real one: a detour never ramps past what the person is already doing.
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

const job = config.jobs.find((j) => j.slug === 'disrupted-plan');

describe('disrupted-plan — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('DP-1: does not set the intensity of every detour with one word', () => {
    expect(template).not.toContain('keep it light and achievable with what they have');
    expect(template).toContain('keep it achievable with what they have');
    expect(template).toContain('never ramp past what they are already doing');
  });

  it('DP-2: register lives in the persona, not the job', () => {
    expect(template).not.toContain('supportive tone');
  });

  it('keeps the boundary that is a rule: additive, never a replacement', () => {
    expect(template).toContain('ADDITIVE temporary plan — do NOT replace the base plan');
  });
});
