/**
 * The walkthrough's log line now says what was lifted and what was swapped (walkthrough v3 Phase
 * 5a): "3×12 @ 15 lb (plan said bodyweight)" and "2×12 @ 40 lb · swapped from glute bridge". The
 * parse must read the load as what was lifted — never the bracketed plan — and read a swap as a
 * replacement, never as a skipped item. Pinned against the config sync-jobs ships.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  jobs: Array<{ slug: string; config: { promptTemplate: string } }>;
};

const template = config.jobs.find((j) => j.slug === 'parse-session-log')?.config.promptTemplate ?? '';
const rule = template.split('\n').find((l) => l.startsWith('- WALKTHROUGH LINES:')) ?? '';

describe('parse-session-log — reads the walkthrough log line shapes', () => {
  it('the item shape carries swapped_from', () => {
    expect(template).toContain('"swapped_from": string|null');
  });

  it('one rule shows both shapes and says the load is what was lifted', () => {
    expect(rule).not.toBe('');
    expect(rule).toContain('3×12 @ 15 lb (plan said bodyweight)');
    expect(rule).toContain('2×12 @ 40 lb · swapped from glute bridge');
    expect(rule).toContain('The load is what was lifted');
    expect(rule).toContain('never the load');
  });

  it('a swap is a replacement, not a skip', () => {
    expect(rule).toContain('INSTEAD of X');
    expect(rule).toContain('do not list X as an item they skipped');
  });

  it('per-set loads are kept as written', () => {
    expect(rule).toContain('"@ [15 lb, 15 lb, 20 lb]"');
    expect(rule).toContain('keep the load as written');
  });
});

/**
 * Walkthrough v3 Phase 6: a rearranged session writes its structure into the line the coach
 * reads. The parse must list the members of a combined group as items (never the group's name),
 * read "one at a time" as spread sets, and keep the words in the summary.
 */
const rearranged = template.split('\n').find((l) => l.startsWith('- REARRANGED LINES:')) ?? '';

describe('parse-session-log — reads the rearranged shapes', () => {
  it('one rule shows the combined group and the spread set', () => {
    expect(rearranged).not.toBe('');
    expect(rearranged).toContain('bench + row circuit · 3 rounds (bench press 3×8 @ 95 lb, dumbbell row 3×10 @ 40 lb)');
    expect(rearranged).toContain('3×45 s · one at a time');
  });

  it('the members are the items, the group is not one', () => {
    expect(rearranged).toContain('list EACH item in the brackets');
    expect(rearranged).toContain('do not list "bench + row" as an item');
  });

  it('a sequence is one item’s sets then the other’s, and the words stay in the summary', () => {
    expect(rearranged).toContain('"in sequence"');
    expect(rearranged).toContain('Keep these words in the summary');
  });

  it('names no move and gives no verdict', () => {
    expect(rearranged).not.toMatch(/should|better|instead you|recommend/i);
  });
});
