/**
 * Owner ruling (2026-09-03): the coach gets the FACTS about the two set flows — what "straight"
 * (A,A,B,B) and "circuit" (A,B,A,B, one rest per round) mean and what each needs — never our
 * verdict about which kind of work each one is for. "Most strength work is straight; circuits
 * suit conditioning or finishers" was our judgement inserted into her reasoning: a person who
 * trains strength as a circuit got two straight sets of everything, and had no way to say so
 * that she was allowed to act on.
 *
 * This test pins the prompt sync-jobs ships, so a prompt edit or a config regeneration that
 * re-issues the steer fails CI. The tool catalog's own summaries are pinned in
 * `@cadence/shared`'s tool-catalog.test.ts, since they are rendered into the same prompt.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  jobs: Array<{ slug: string; config: { promptTemplate: string } }>;
};

const job = config.jobs.find((j) => j.slug === 'prescribe-session');

describe('prescribe-session — set flow is a fact, not a pick', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('never tells the coach which kind of work each set flow is for', () => {
    // The exact directives that used to sit in this prompt.
    expect(template).not.toContain('Most strength work is straight');
    expect(template).not.toContain('circuits suit conditioning or finishers');
    expect(template).not.toContain('omit it for ordinary strength work');
    expect(template).not.toContain('only for items done together');
  });

  it('still defines both flows as facts, with the one thing that is a rule: a circuit needs rounds', () => {
    expect(template).toMatch(/"straight" \(.*A,A,B,B/);
    expect(template).toMatch(/"circuit" \(.*A,B,A,B/);
    expect(template).toMatch(/"rounds" required/);
    expect(template).toMatch(/Both are available for any kind of work/);
  });
});
