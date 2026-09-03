/**
 * The practice session chooses its own material.
 *
 * The prompt used to name the picks: `<warmup_pick>` was "the Keeping up item rested longest. Do
 * not pick a different one", `<next_rested>` was the play-out, `<up_next_top>` a forecast, and each
 * block had to be labelled with the group it came from. The owner ruled all of it out (2026-09-03)
 * — *"It's a reasoning model. It can reason and it can discuss the best thing with the user."* —
 * so one plain line hands her the shelf and asks her to say why she chose what she chose.
 *
 * Pinned against the config sync-jobs ships, because that is what actually reaches the model: a
 * prompt edit or a config regeneration that puts a pick back fails CI instead of quietly changing
 * what Thursday looks like. Every row is a near-miss as much as a positive — the old lines all
 * produced valid sessions, which is exactly why nothing caught them.
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

/** The four that named a pick. Each was declared, interpolated, and consumed by a rule. */
const RETIRED_VARIABLES = ['warmup_pick', 'next_rested', 'learning', 'up_next_top'];

describe('prescribe-session — she chooses the material, and says why', () => {
  it('exists in the config sync-jobs ships', () => {
    expect(job, 'prescribe-session must exist in the config').toBeDefined();
  });

  it('says what <repertoire> holds, in facts', () => {
    expect(template).toContain(
      '- REPERTOIRE: when <repertoire> is non-empty it lists what they play, with standing, last-practised date, settled tempo, and notes.',
    );
  });

  it('tells her to choose the material herself and to state her reason per item', () => {
    expect(template).toContain(
      "Choose warm-up, learning, and play-out material yourself from it, and say in each item's detail why you chose it.",
    );
  });

  it('still refuses to invent, and still tells a failed read apart from an empty shelf', () => {
    expect(template).toContain('do not invent what they know');
    expect(template).toContain('could not be read');
  });

  it.each(RETIRED_VARIABLES)('no longer declares or interpolates {{%s}}', (name) => {
    expect(template).not.toContain(`{{${name}}}`);
    expect(template).not.toContain(`<${name}>`);
    expect(variables.find((v) => v.name === name)).toBeUndefined();
  });

  it('keeps {{repertoire}}, declared and not required — a gym session sends it empty', () => {
    expect(template).toContain('{{repertoire}}');
    const declared = variables.find((v) => v.name === 'repertoire');
    expect(declared, "repertoire must be declared in the job's variables").toBeDefined();
    expect(declared?.required ?? false).toBe(false);
  });

  /**
   * The table of what a picking rule looked like. Each phrase shipped in this template until
   * 2026-09-03; each one reads as a correct instruction and produces a plausible session, so only
   * an explicit row can catch its return.
   */
  it.each([
    ['names the warm-up for her', /rested longest/i],
    ['forbids a different choice', /Do not pick a different one/i],
    ['ranks by rest', /longest rest/i],
    ['marks one item', /DUE NEXT/i],
    ['counts the Learning work for her', /keep it to one or two/i],
    ['orders the play-out', /finish on one Keeping up item/i],
    ['makes Up next a forecast slot', /is a FORECAST, never a step/i],
    ['forbids scheduling Learned', /never schedule it/i],
    ['dictates the block labels', /Warm up — from Keeping up/],
  ])('carries no rule that %s', (_what, pattern) => {
    expect(template).not.toMatch(pattern);
  });

  it('leaves the rest of the job alone — the other rules are still there', () => {
    for (const rule of [
      'CONSTRAINT SAFETY',
      'EVERY JOURNAL ITEM CARRIES ITS QUESTION',
      'SESSION LENGTH FITS THE ACTIVITY',
      'COACHING ARC',
      'WEATHER',
      'SET FLOW',
      'STEER',
    ]) {
      expect(template).toContain(rule);
    }
  });
});
