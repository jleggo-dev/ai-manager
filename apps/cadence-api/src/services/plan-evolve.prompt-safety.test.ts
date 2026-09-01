import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Owner ruling (2026-09-01): the evolve job may run on a faster model than genesis synthesis —
 * ON CONDITION that it always receives and is bound by the user's goals, current plan, and
 * constraints. The model is allowed to be cheaper; the briefing is not.
 *
 * This test is that condition made durable. It pins the evolve-plan prompt's safety-bearing
 * parts so a future prompt edit (or a config regeneration) that drops them fails CI instead of
 * shipping a rebuild that no longer knows about a bad knee. It deliberately reads the CONFIG,
 * not a constant: the config is what sync-jobs.ts ships to the live engine.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  jobs: Array<{ slug: string; config: { promptTemplate: string; variables: Array<{ name: string }> } }>;
};

const evolve = config.jobs.find((j) => j.slug === 'evolve-plan');

describe('evolve-plan prompt safety floor', () => {
  it('exists in the config sync-jobs ships', () => {
    expect(evolve).toBeDefined();
  });

  it('is briefed with the full safety context, whatever model runs it', () => {
    const vars = evolve!.config.variables.map((v) => v.name);
    for (const required of ['goals', 'baseline', 'current_plan', 'recent_activity']) {
      expect(vars).toContain(required);
    }
    const t = evolve!.config.promptTemplate;
    // The template must actually interpolate them — a declared-but-unused variable briefs nobody.
    for (const tag of ['{{goals}}', '{{baseline}}', '{{current_plan}}']) {
      expect(t).toContain(tag);
    }
  });

  it('keeps the constraint-safety rules that bind every model equally', () => {
    const t = evolve!.config.promptTemplate;
    expect(t).toContain('CONSTRAINT SAFETY');
    expect(t).toContain('plan_around');
    // Quiet constraints cap the ramp, never the modality — the rule that keeps a settled knee
    // from costing a runner their running.
    expect(t).toMatch(/quiet.*caps the RAMP RATE/i);
    // The steer is the user's voice, but it never outranks safety.
    expect(t).toMatch(/never overrides constraint safety/i);
  });
});
