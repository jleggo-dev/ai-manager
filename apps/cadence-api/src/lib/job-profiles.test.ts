import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isProfilePlaceholder, resolveProfileToken, resolveJobProfileIds } from './job-profiles.ts';

const COACH = 'coach-uuid-1111';
const BROKER = 'broker-uuid-2222';
const ids = { coachId: COACH, brokerId: BROKER };

/** The real shipped config — these tests are the contract between it and the sync scripts. */
const CONFIG = JSON.parse(
  readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../config/ai-admin/ai-admin.config.json'),
    'utf8',
  ),
) as { jobs: Array<{ slug: string; ai_profile_id: string }> };

describe('job profile resolution', () => {
  it('resolves a coach placeholder to the coach profile', () => {
    const jobs = [{ slug: 'synthesize-plan', ai_profile_id: '<CADENCE_COACH_PROFILE_UUID>' }];
    resolveJobProfileIds(jobs, ids);
    expect(jobs[0]!.ai_profile_id).toBe(COACH);
  });

  it('resolves a broker placeholder to the broker profile', () => {
    const jobs = [{ slug: 'capture-extract', ai_profile_id: '<CADENCE_BROKER_PROFILE_UUID>' }];
    resolveJobProfileIds(jobs, ids);
    expect(jobs[0]!.ai_profile_id).toBe(BROKER);
  });

  // The regression that matters: parse-meal (and Req 5 vision capture jobs) are pinned to the
  // live Gemini vision profile. A sync must never steal them back to the broker.
  it('leaves an explicitly pinned profile UUID untouched', () => {
    const pinned = '61541478-fd03-4bc8-8e03-ec5284eb66c3';
    const jobs = [{ slug: 'parse-meal', ai_profile_id: pinned }];
    resolveJobProfileIds(jobs, ids);
    expect(jobs[0]!.ai_profile_id).toBe(pinned);
    expect(jobs[0]!.ai_profile_id).not.toBe(BROKER);
  });

  it('keeps Req 5 vision capture jobs pinned in the shipped config', () => {
    const pinned = '61541478-fd03-4bc8-8e03-ec5284eb66c3';
    for (const slug of ['parse-meal', 'plate-advice', 'parse-nutrition-label', 'identify-food']) {
      const job = CONFIG.jobs.find((j) => j.slug === slug);
      expect(job, `${slug} missing from ai-admin.config.json`).toBeTruthy();
      expect(job!.ai_profile_id, `${slug} must stay on Gemini vision`).toBe(pinned);
    }
    const estimate = CONFIG.jobs.find((j) => j.slug === 'estimate-food');
    expect(estimate, 'estimate-food missing').toBeTruthy();
    expect(estimate!.ai_profile_id).toBe('<CADENCE_BROKER_PROFILE_UUID>');
  });

  it('throws on an unrecognized placeholder rather than defaulting to a cheaper model', () => {
    const jobs = [{ slug: 'mystery', ai_profile_id: '<CADENCE_TYPO_PROFILE_UUID>' }];
    expect(() => resolveJobProfileIds(jobs, ids)).toThrow(/Unknown ai_profile_id placeholder/);
  });

  it('recognizes placeholders vs real ids', () => {
    expect(isProfilePlaceholder('<CADENCE_COACH_PROFILE_UUID>')).toBe(true);
    expect(isProfilePlaceholder('61541478-fd03-4bc8-8e03-ec5284eb66c3')).toBe(false);
    expect(isProfilePlaceholder(undefined)).toBe(false);
  });

  it('resolveProfileToken maps both tiers', () => {
    expect(resolveProfileToken('<CADENCE_COACH_PROFILE_UUID>', ids)).toBe(COACH);
    expect(resolveProfileToken('<CADENCE_BROKER_PROFILE_UUID>', ids)).toBe(BROKER);
  });

  describe('against the real ai-admin.config.json', () => {
    // This is the guard that the old hardcoded slug-set approach lacked: it silently disagreed
    // with the config and synced nutrition-baseline (declared COACH) to the Broker model.
    it('every job resolves to the tier its own placeholder declares', () => {
      const jobs = CONFIG.jobs.map((j) => ({ slug: j.slug, ai_profile_id: j.ai_profile_id }));
      const declared = new Map(jobs.map((j) => [j.slug, j.ai_profile_id]));
      resolveJobProfileIds(jobs, ids);

      for (const job of jobs) {
        const token = declared.get(job.slug)!;
        if (!isProfilePlaceholder(token)) {
          expect(job.ai_profile_id, `${job.slug} is pinned and must not be rewritten`).toBe(token);
          continue;
        }
        const expected = token.includes('COACH') ? COACH : BROKER;
        expect(job.ai_profile_id, `${job.slug} declared ${token} but resolved elsewhere`).toBe(expected);
      }
    });

    it('nutrition-baseline lands on the coach model (the Baseline moment is coached)', () => {
      const jobs = CONFIG.jobs.map((j) => ({ slug: j.slug, ai_profile_id: j.ai_profile_id }));
      resolveJobProfileIds(jobs, ids);
      expect(jobs.find((j) => j.slug === 'nutrition-baseline')!.ai_profile_id).toBe(COACH);
    });

    it('structure-recipe lands on the coach placeholder (Req 5 WS3)', () => {
      const job = CONFIG.jobs.find((j) => j.slug === 'structure-recipe');
      expect(job, 'structure-recipe missing from ai-admin.config.json').toBeTruthy();
      expect(job!.ai_profile_id).toBe('<CADENCE_COACH_PROFILE_UUID>');
      const jobs = CONFIG.jobs.map((j) => ({ slug: j.slug, ai_profile_id: j.ai_profile_id }));
      resolveJobProfileIds(jobs, ids);
      expect(jobs.find((j) => j.slug === 'structure-recipe')!.ai_profile_id).toBe(COACH);
      const baselineIdx = CONFIG.jobs.findIndex((j) => j.slug === 'nutrition-baseline');
      const structureIdx = CONFIG.jobs.findIndex((j) => j.slug === 'structure-recipe');
      expect(structureIdx).toBeGreaterThanOrEqual(0);
      expect(structureIdx).toBeLessThan(baselineIdx);
    });
  });
});
