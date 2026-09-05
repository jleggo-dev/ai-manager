/**
 * Owner ruling ("facts, not picks"): a prompt carries facts, definitions, safety boundaries and
 * the output contract — never what to prefer, how many, which kind, when, or what to say.
 *
 * compose-now-menu used to map identity to offer: a novelist gets craft (and is banned from a
 * gratitude prompt), someone training gets a stretch, mind tools are suspect for everyone, most
 * menus have no pin, and the technical name of a technique may never be spoken. All of that is
 * a pick. What stays is the mechanical fact underneath it — the app prints the parameters, an
 * unlisted name is dropped, a tool name in the label is wrong.
 *
 * This test pins the prompt sync-jobs ships, so a config regeneration that re-issues the steers
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

const job = config.jobs.find((j) => j.slug === 'compose-now-menu');

describe('compose-now-menu — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('NM-1: no fixed mapping from identity to journal bank, and no banned pairing', () => {
    expect(template).not.toContain('a novelist gets craft, a student gets study');
    expect(template).not.toContain('NEVER hand a novelist a gratitude prompt');
    expect(template).toContain('each bank in <journal_banks> names the practice it serves');
  });

  it('NM-2: fits the items to the person and the situation instead of listing who gets what', () => {
    expect(template).not.toContain('someone working on calm gets settling and grounding options');
    expect(template).not.toContain('someone training gets a stretch or a few extra reps');
    expect(template).toContain('Fit the items to this person and to <situation>');
  });

  it('NM-3: carries no standing suspicion of the mind area', () => {
    expect(template).not.toContain('Mind tools are not automatically right for everyone');
  });

  it('NM-4: states the criterion for a pin, not the base rate', () => {
    expect(template).not.toContain('Most menus have no pin');
    expect(template).toContain('PIN AT MOST ONE item (pinned=true)');
  });

  it('NM-5: does not forbid the technical name — it says what the app already prints', () => {
    expect(template).not.toContain('NEVER name the tool or the technique');
    expect(template).not.toContain('not "Box breathing"');
    expect(template).toContain('The app prints the technique and its parameters on the line under the label');
  });

  it('NM-5: keeps the output contract that follows it', () => {
    expect(template).toContain('If the label contains a tool name from <tools>');
  });
});
