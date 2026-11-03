/**
 * Walkthrough v3, Phase 3b: the repair loop hands the coach the checker's findings in
 * `<check_findings>`. Pinned against the config sync-jobs ships, like the other prescribe-session
 * tests, because what reaches the model is the config and not the source.
 *
 * Two things must hold. The variable and the tag exist, with a rule that says what the tag holds
 * (facts the app found about her previous answer). And the rule says NOTHING about which moves
 * are timed, which are reps, or what a carry is — "facts, not picks" (owner, 2026-09-03): the
 * findings carry the evidence, and the catalog carries the tools; the rule only says how to read
 * the tag.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  jobs: Array<{ slug: string; config: { promptTemplate: string; variables?: Array<{ name: string }> } }>;
};

const job = config.jobs.find((j) => j.slug === 'prescribe-session');
const template = job?.config.promptTemplate ?? '';
/** The one rule line that explains the tag. */
const rule = template.split('\n').find((l) => l.startsWith('- CHECK FINDINGS:')) ?? '';

describe('prescribe-session — check_findings is a variable the prompt reads', () => {
  it('declares the variable', () => {
    expect(job?.config.variables?.some((v) => v.name === 'check_findings')).toBe(true);
  });

  it('carries the tag next to the other inputs', () => {
    expect(template).toContain('<check_findings>{{check_findings}}</check_findings>');
  });

  it('has one rule that says the tag holds facts about her previous answer and asks for the whole session back', () => {
    expect(rule).not.toBe('');
    expect(rule).toContain('<check_findings>, when non-empty, lists facts the app found about your previous answer');
    expect(rule).toContain('return the whole session again');
    expect(rule).toContain('When it is empty there was no previous answer');
  });

  it('defines the two marks as facts about the app', () => {
    expect(rule).toContain('An error is a step the app cannot play as written');
    expect(rule).toContain('A question is a shape the app is not sure of');
  });
});

describe('prescribe-session — the check rule names no tool and no move (facts, not picks)', () => {
  it.each([
    /\btimer\b/i,
    /\breps?\b/i,
    /\bcheckoff\b/i,
    /\binterval\b/i,
    /\bcarr(y|ies)\b/i,
    /\bhangs?\b/i,
    /\bplanks?\b/i,
    /\bholds?\b/i,
    /\bsets\b/i,
    /\bseconds?\b/i,
    /\bduration_min\b/,
  ])('the rule does not match %s', (pattern) => {
    expect(rule).not.toMatch(pattern);
  });

  it('the rule never tells her what to change a step INTO', () => {
    expect(rule).not.toMatch(/should be a|must be a|use the \w+ tool|instead of/i);
  });
});
