/**
 * Owner ruling (2026-09-03, "facts, not picks"): a job prompt carries FACTS, DEFINITIONS, the
 * safety and consent boundaries, and the output contract — never what to prefer, how many, which
 * kind, when, or what to say. The removals below were the picks: a four-meal default day, an observation window before any eating change, a support quota, a day-count band, and a first week the prompt decided must be light.
 *
 * This pins the prompt in the CONFIG sync-jobs ships, so a prompt edit or a config regeneration
 * that re-issues a removed steer fails CI.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  jobs: Array<{ slug: string; config: { promptTemplate: string; variables?: Array<{ name: string }> } }>;
};

const job = config.jobs.find((j) => j.slug === 'synthesize-plan');

describe('synthesize-plan — facts, not picks', () => {
  const template = job?.config.promptTemplate ?? '';

  it('exists in the config sync-jobs ships', () => {
    expect(job).toBeDefined();
  });

  it('SP-1/SP-2 — the meal set is what they eat, not four fixed clock times', () => {
    expect(template).not.toContain(
      'one each for breakfast (~08:00), lunch (~12:30), a snack (~15:30), and dinner (~18:30)',
    );
    expect(template).not.toContain('16:8 usually means no breakfast');
    expect(template).toContain('one per meal they actually eat, at the time they eat it');
    expect(template).toContain('when eating_window carries no clock times, only said_as, the hours are not known');
  });

  it('SP-3 — no observation window gating an eating change', () => {
    expect(template).not.toContain('The food module OBSERVES FIRST');
    expect(template).not.toContain('prescribe NO eating changes');
    expect(template).not.toContain('At 7+ logged days, introduce exactly ONE gradual eating change');
    expect(template).toContain('<recent_activity> states how many days of food_log data exist');
  });

  it('SP-4 — a horizon is a fact, not a ban on intensity', () => {
    expect(template).not.toContain('never intense work now');
    expect(template).toContain("A goal's horizon — how far off its milestone is — is in <confirmed_goals>");
  });

  it('SP-5 — warm-up and cool-down sit around duration_min; no ten-minute figure here', () => {
    expect(template).not.toContain('45 minutes free means duration_min around 35');
    expect(template).not.toContain('Mind and practice sessions need no such margin');
    expect(template).toContain('warm-up and cool-down sit AROUND duration_min, never inside it');
  });

  it('SP-6 — observed_health.trains is a fact, not a floor with a verdict attached', () => {
    expect(template).not.toContain('a runner gets running, not a walk');
    expect(template).toContain('what this week asks of them is yours to judge');
  });

  it('SP-7 — mind work takes the one-sitting test, it does not split by default', () => {
    expect(template).not.toContain('MIND WORK SPLITS BY DEFAULT');
    expect(template).not.toContain('Give them their own activities and their own times UNLESS');
    expect(template).toContain('MIND WORK TAKES THE SAME TEST');
    expect(template).toContain(
      'ONE activity when they are done in one sitting and SEPARATE activities when they are not',
    );
  });

  it('SP-8 — the other occasions are named, not counted', () => {
    expect(template).not.toContain('Two or three of these beside the core is a week, not a workload');
    expect(template).toContain("Which of them this person's work needs is theirs to tell you");
  });

  it('SP-9/SP-10/SP-11 — no support quota, no anchor menu, no rarity rule', () => {
    expect(template).not.toContain('ADD 1-2 SUPPORTING activities');
    expect(template).not.toContain('THE BEST SUPPORT IS SMALL AND ANCHORED');
    expect(template).not.toContain('usually 5-15 minutes, never the biggest block of the week');
    expect(template).not.toContain('should be the rarity, not the norm');
    expect(template).toContain('is your proposal, and the plan marks it as one');
    expect(template).toContain('AN ANCHOR IS A MOMENT THE DAY ALREADY HAS');
  });

  it('SP-12 — no items-per-day band', () => {
    expect(template).not.toContain('aim for roughly 3-5 things on a normal day');
    expect(template).not.toContain('a day may carry up to 7');
    expect(template).toContain('how many things a day carries is yours to strike');
  });

  it('SP-13/SP-14 — a first plan is a fact about the logs, and building is not hedged', () => {
    expect(template).not.toContain("Don't front-load intensity");
    expect(template).not.toContain("week one is discovery, like a real coach's first week");
    expect(template).not.toContain('gently build (more volume/intensity/distance)');
    expect(template).toContain('this is their FIRST plan and nothing has been logged yet');
    expect(template).toContain("If they've been consistent and progressing, build (more volume/intensity/distance).");
  });

  it('SP-15/SP-16 — a miss count moves nothing on its own, and a quiet constraint is not a program', () => {
    expect(template).not.toContain('do NOT shrink their week on a miss count alone');
    expect(template).not.toContain('hold the shape they have');
    expect(template).not.toContain('progress in small steps rather than jumps, add a prehab element');
    expect(template).toContain('a miss count alone does not say which way the plan should move');
  });

  it('SP-17 — the deload fields are defined, not preset', () => {
    expect(template).not.toContain('"deload_every": 4, "deload_pct": 90');
    expect(template).toContain('"deload_every": number (every Nth week backs off; omit it for no deload week)');
  });

  it('SP-18/SP-19 — no phases template, and the weigh-in cadence is not fixed at weekly', () => {
    expect(template).not.toContain('the phases when the goal has them');
    expect(template).not.toContain('four mornings a week is about 500 words a sitting');
    expect(template).not.toContain('also schedule a weekly weigh-in');
    expect(template).toContain('also schedule a weigh-in (kind=system) at whatever cadence fits this person');
  });
});
