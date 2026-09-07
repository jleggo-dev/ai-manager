/**
 * The prescribe-session output contract names the per-tool fields.
 *
 * The prompt opens with "Return ONLY this JSON" and an item shape. Until 2026-09-06 that shape
 * listed nine fields and none of the per-tool ones — no metronome_bpm, no journal_bank, no
 * breath_pattern — and the catalog that DID name them sat two thousand characters lower, under a
 * heading. A model told "only this" reads the shape as the contract, so a scales step went out
 * without a tempo and the walkthrough drew no metronome (2026-09-06, the owner's piano practice).
 *
 * Pinned against the config sync-jobs ships, like the other prescribe-session tests: what reaches
 * the model is the config, not the source, and a regeneration that drops the fields must fail here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  jobs: Array<{ slug: string; config: { promptTemplate: string } }>;
};

const template = config.jobs.find((j) => j.slug === 'prescribe-session')?.config.promptTemplate ?? '';

/** The "Return ONLY this JSON" line — the shape the model treats as the contract. */
const shapeLine = template.split('\n').find((l) => l.startsWith('{ "blocks":')) ?? '';

describe('prescribe-session — the item shape carries the per-tool fields', () => {
  it('has a shape line at all', () => {
    expect(shapeLine).not.toBe('');
  });

  it.each(['"metronome_bpm": number|null', '"metronome_meter": number|null'])(
    'the shape line names %s',
    (field) => {
      expect(shapeLine).toContain(field);
    },
  );

  it('the shape line points at the catalog for the rest, instead of closing the list', () => {
    expect(shapeLine).toContain('...the fields <tool_catalog> lists for the tool you chose');
  });

  it('a rule says the per-tool fields sit on the item — and names the ones a session most often needs', () => {
    expect(template).toContain('- PER-TOOL FIELDS ARE PART OF THE ITEM:');
    for (const f of ['journal_bank', 'breath_pattern', 'meditate_bells', 'grounding_game', 'interval_*', 'per_side']) {
      expect(template, `the rule names ${f}`).toContain(f);
    }
  });

  it('states the consequence as a fact, not a preference: no tempo means no metronome, ever', () => {
    expect(template).toContain('a step without them has no metronome in the app, and nothing adds one later');
  });

  /** Near-misses: the rule must not become a pick about WHEN to use a metronome. */
  it.each([/always add a metronome/i, /every practice step/i, /SET IT for:/, /DO NOT SET IT for:/])(
    'carries no picking rule matching %s',
    (pattern) => {
      expect(template).not.toMatch(pattern);
    },
  );
});
