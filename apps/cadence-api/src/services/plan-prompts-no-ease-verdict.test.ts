/**
 * Owner ruling (2026-09-01): the coach gets the FACTS about what was and wasn't done, never our
 * verdict about what they mean. "They missed sessions, so ease off" is our judgement inserted into
 * her reasoning — the person may want to keep going rather than do less, and that is theirs to
 * say. Easing is a discussion point, not a rule.
 *
 * The one thing that IS a rule is safety: you cannot ramp someone to longer or faster work on work
 * they never completed. This test pins both halves in the CONFIG sync-jobs ships, so a prompt edit
 * or a config regeneration that re-issues the verdict — or drops the safety limit — fails CI.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  jobs: Array<{ slug: string; config: { promptTemplate: string } }>;
};

const promptFor = (slug: string): string => {
  const job = config.jobs.find((j) => j.slug === slug);
  expect(job, `${slug} must exist in the config sync-jobs ships`).toBeDefined();
  return job!.config.promptTemplate;
};

describe.each(['synthesize-plan', 'evolve-plan'])('%s — a miss is a fact, not a verdict', (slug) => {
  const template = promptFor(slug);

  it('never tells the coach to ease the week because sessions were missed', () => {
    // The exact directives that used to sit in these prompts. They never fired while the miss
    // count was structurally zero; the count is honest now, so they would have started steering.
    expect(template).not.toContain('ease off — fewer, lighter, or more restorative sessions');
    expect(template).not.toContain('Ease load only on plan-engagement evidence');
    expect(template).not.toContain('ease load only on the plan-engagement counts');
    expect(template).not.toContain('only ease when there is real evidence of missing or skipping');
  });

  it('keeps the safety limit that is a rule: no ramp past work actually completed', () => {
    expect(template).toMatch(/NEVER progress load past work they actually completed/);
  });

  it('says the counts describe what happened, never why', () => {
    expect(template).toMatch(/what happened, never why/);
  });
});
