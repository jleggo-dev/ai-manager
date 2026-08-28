import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Prompt-contract tests against the REAL shipped config.
 *
 * Every defect that produced the 45-minute-walk plan for a 50 km ultra runner was a prompt
 * defect, and not one of them was visible to a unit test: the code did exactly what it was told.
 * A bake-off is the only thing that can say whether a model OBEYS these clauses; what these tests
 * do is far narrower and still worth having — they fail if a load-bearing clause is edited away,
 * which is how the last one was lost.
 *
 * Keep them keyed to short, meaning-carrying phrases. Asserting whole paragraphs would make every
 * wording improvement a test failure, and a test that punishes editing a prompt is a test that
 * stops the prompt being improved.
 */
const CONFIG = JSON.parse(
  readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../config/ai-admin/ai-admin.config.json'),
    'utf8',
  ),
) as { jobs: Array<{ slug: string; config: { promptTemplate: string } }> };

const prompt = (slug: string): string => {
  const job = CONFIG.jobs.find((j) => j.slug === slug);
  if (!job) throw new Error(`no job "${slug}" in the shipped config`);
  return job.config.promptTemplate;
};

describe('capture-extract prompt (the Broker contract)', () => {
  /**
   * THE root cause. The capture window is the whole conversation with each line prefixed
   * "Coach:" or "User:" (captureWindow in routes/coach.ts), but the prompt only ever said
   * "explicitly stated in <user_input>" — never BY WHOM. So the Broker read the coach's own
   * readback, "you've been hitting about 2-3 sessions a week", as a statement of fact and
   * captured 2. On a replay of the logged prompt gpt-4.1-mini did it 6 times out of 6.
   */
  it('tells the Broker that only a User: line is a statement of fact', () => {
    const p = prompt('capture-extract');
    expect(p).toContain('WHO SAID IT');
    expect(p).toMatch(/TRANSCRIPT OF TWO SPEAKERS/);
    expect(p).toMatch(/ONLY a "User:" line is a statement of fact/);
    expect(p).toMatch(/NEVER capture a number.*because a "Coach:" line contains it/);
  });

  it('carries the readback that actually fooled it as a worked example', () => {
    expect(prompt('capture-extract')).toContain("you've been hitting about 2-3 sessions a week");
  });

  it('never asks for days_per_week again', () => {
    // The field went null -> 1 -> 2.5 -> 2, every value read off what he was already doing, and
    // then capped his week. It is a manual-only key now; capture must not name it as an output.
    expect(prompt('capture-extract')).not.toContain('days_per_week');
  });

  it('refuses a target that describes no change', () => {
    // Shipped in production, 2 of 3 replays: {target:195, start:195, direction:"decrease"}.
    expect(prompt('capture-extract')).toMatch(/NEVER emit a target equal to start/);
  });

  it('lets someone own a home gym they cannot itemize yet', () => {
    // Confirmed a prompt bug, not a model bug: he named no ITEMS, so [] was obedient — and an
    // empty list reads downstream as owning nothing.
    expect(prompt('capture-extract')).toMatch(/cannot list them yet/);
  });
});

describe('parse-nutrition-label prompt (labels print more than macros)', () => {
  /**
   * MP28/MP12: a real dried-mushroom label (Borde / The Wild Mushroom Co, PLAN.md test case)
   * prints potassium 250 mg, calcium 10 mg, iron 0.3 mg — all three silently discarded because
   * the prompt's declared JSON shape and its "report only if printed" rule never named them.
   * Three, not six: the prompt already asked for fiber_g and sodium_mg.
   */
  it('declares iron_mg, calcium_mg and potassium_mg in the returned JSON shape', () => {
    const p = prompt('parse-nutrition-label');
    expect(p).toContain('"iron_mg": number|null');
    expect(p).toContain('"calcium_mg": number|null');
    expect(p).toContain('"potassium_mg": number|null');
  });

  it('extends the "only if printed" rule to the three new micronutrients', () => {
    const p = prompt('parse-nutrition-label');
    expect(p).toMatch(/fiber_g \/ sodium_mg \/ iron_mg \/ calcium_mg \/ potassium_mg ONLY if printed; else null/);
  });

  it('carries the dried-mushroom label as a worked example of the new fields', () => {
    const p = prompt('parse-nutrition-label');
    expect(p).toContain('"iron_mg":0.3');
    expect(p).toContain('"calcium_mg":10');
    expect(p).toContain('"potassium_mg":250');
  });
});

describe('synthesize-plan prompt (what the planner is told to do with it)', () => {
  it('keeps observed history apart from our occurrences, and treats it as a floor', () => {
    const p = prompt('synthesize-plan');
    expect(p).toContain('OBSERVED HISTORY IS NOT OUR OCCURRENCES');
    expect(p).toMatch(/CURRENT CAPACITY to build FROM/);
    expect(p).toMatch(/never as a ceiling/);
  });

  it('reads a quiet constraint as a ramp-rate caution rather than a ban', () => {
    const p = prompt('synthesize-plan');
    expect(p).toMatch(/RAMP RATE, not a ban/);
    expect(p).toMatch(/NEVER delete an entire modality/);
  });
});
