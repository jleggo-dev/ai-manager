/**
 * The practice session names the group each part was drawn from.
 *
 * Design frames 2b/3c: Thursday's practice is the shelf read back, so moving a piece between
 * standings predicts what changes on Thursday. That only holds if the block LABEL says where the
 * part came from ("Warm up — from Keeping up") and if the prompt's rules match what
 * `session-practice-facts.ts` actually hands over. Both live in the config sync-jobs ships, so this
 * pins them there: a prompt edit or a config regeneration that drops a rule, drops a tag, or
 * renames a label fails CI instead of quietly changing what Thursday looks like.
 *
 * The four variables are declared but NOT required — they are empty for every goal with no shelf,
 * and an empty tag is ignored by the template.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  jobs: Array<{
    slug: string;
    config: { promptTemplate: string; variables: Array<{ name: string; required?: boolean }> };
  }>;
};

const job = config.jobs.find((j) => j.slug === 'prescribe-session');
const template = job?.config.promptTemplate ?? '';
const variables = job?.config.variables ?? [];

/** The `label` normalizeSession will store for each block. Bounded at 40 chars there. */
const BLOCK_LABELS = ['Warm up — from Keeping up', 'Learn — from Learning', 'Play out — from Keeping up'];

const FACT_VARIABLES = ['warmup_pick', 'next_rested', 'learning', 'up_next_top'];

describe('prescribe-session — the practice parts name their standing', () => {
  it('exists in the config sync-jobs ships', () => {
    expect(job, 'prescribe-session must exist in the config').toBeDefined();
  });

  it.each(BLOCK_LABELS)('tells the coach to label a block "%s"', (label) => {
    expect(template).toContain(label);
    expect(label.length).toBeLessThanOrEqual(40); // normalizeSession slices the label at 40
  });

  it('never offers a label that hides where the part came from', () => {
    // The near-miss: a bare "Warm up" is the label she wrote before this, and it is exactly what
    // the suffix exists to replace. Each instruction must carry its group.
    for (const label of BLOCK_LABELS) expect(template).toContain(`"${label}"`);
  });

  it('draws the warm-up from the given pick, not from her own guess', () => {
    expect(template).toMatch(/<warmup_pick>[\s\S]*rested longest/);
    expect(template).toContain('Do not pick a different one');
  });

  it('makes Up next a forecast with an ask, never a step', () => {
    expect(template).toContain('<up_next_top>');
    expect(template).toMatch(/never a step/i);
    expect(template).toMatch(/ASK before starting it/);
  });

  it('never schedules Learned', () => {
    expect(template).toMatch(/never schedule it/i);
  });

  it('says the Learning entries carry the practice note and the last words', () => {
    expect(template).toContain('practice note');
    expect(template).toContain('last words');
  });

  it.each(FACT_VARIABLES)('interpolates {{%s}} and declares it', (name) => {
    expect(template).toContain(`{{${name}}}`);
    const declared = variables.find((v) => v.name === name);
    expect(declared, `${name} must be declared in the job's variables`).toBeDefined();
    // Not required: a gym session sends it empty, and a required-but-empty variable is a job error.
    expect(declared?.required ?? false).toBe(false);
  });

  it('keeps the standings block short enough to be worth its tokens on every prescribe call', () => {
    const block = template.split('- PRACTICE SESSIONS DRAW FROM THE STANDINGS')[1]?.split('\n- ')[0] ?? '';
    expect(block.length).toBeGreaterThan(0);
    expect(block.length).toBeLessThan(1400);
  });
});
