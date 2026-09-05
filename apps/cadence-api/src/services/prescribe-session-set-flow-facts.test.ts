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
  jobs: Array<{ slug: string; config: { promptTemplate: string; variables?: Array<{ name: string }> } }>;
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

/**
 * Owner ruling (2026-09-03, "facts, not picks") — the rest of prescribe-session. The biggest
 * removal is the COACHING ARC: `coachingPhase()` sorted every activity into discover / calibrate /
 * progress from the log count, and the prompt then told her how each phase behaves. The log count
 * IS the fact; what to do with it is hers. The function, its `phase` variable and the `phase`
 * prompt variable are all gone — `sessions_logged` and `recent_logs` are what she gets.
 */
describe('prescribe-session — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('has no coaching-arc phase machinery left', () => {
    expect(template).not.toContain('COACHING ARC');
    expect(template).not.toContain('<phase>');
    expect(template).not.toContain('{{phase}}');
    expect(template).not.toContain('discover (0 logged)');
    expect(template).not.toContain('calibrate (1-2 logged)');
    expect(template).not.toContain('progress (3+ logged)');
    expect(template).not.toContain('apply them gently');
    expect(template).not.toContain('nudge one variable up');
    expect(job?.config.variables?.some((v) => v.name === 'phase')).toBe(false);
  });

  it('keeps the two facts and the one rule that survived the arc', () => {
    expect(template).toContain('<sessions_logged> is how many sessions of THIS activity they have logged');
    expect(template).toContain('<recent_logs> holds those logs, newest first');
    expect(template).toContain('Never progress load past work they actually completed');
  });

  it('PS-3/PS-4/PS-5 — states the app-enforced caps, not a preferred session shape', () => {
    expect(template).not.toContain('mind and practice activities are usually one to three');
    expect(template).not.toContain('2-4 blocks');
    expect(template).not.toContain('roughly five minutes each for physical work');
    expect(template).not.toContain('~30-60 min is the default');
    expect(template).toContain('At most 6 blocks, and at most 12 items in a block; the app drops the rest.');
    expect(template).toContain('the length of the session is yours to set with this person');
  });

  it('PS-9 — a non-physical constraint is a capacity fact, not a session style', () => {
    expect(template).not.toContain('keep the session humane');
    expect(template).not.toContain('shorter, restorative options, no heroics');
    expect(template).toContain('a fact about the capacity they have right now');
  });

  it('PS-10/PS-11 — any bank fits any journal item, and video_query is defined by its use', () => {
    expect(template).not.toContain('Match the bank family to the practice');
    expect(template).not.toContain('ONLY for a physical movement a beginner might not know');
    expect(template).toContain('any bank is valid on any journal item');
    expect(template).toContain('where seeing it performed would help');
  });
});
