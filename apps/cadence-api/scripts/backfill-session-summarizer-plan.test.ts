import { describe, expect, it } from 'vitest';
import { planBackfill, withSummarizer, type BackfillSession } from './backfill-session-summarizer-plan.ts';

/**
 * Which sessions the summarizer backfill rewrites (HARNESS-V3 P1b, finding G). Positives and
 * near-misses: a session for another job is never touched, and one already on the live policy is
 * counted, not rewritten — key order included.
 */
const LIVE = { jobSlug: 'coach-compact', triggerTokens: 42_000, keepTailUnits: 12_000 };
const COACH = 'job-coach';
const SINCE = '2026-10-01T00:00:00Z';
const s = (id: string, over: Partial<BackfillSession> = {}): BackfillSession => ({
  id,
  processing_job_id: COACH,
  updated_at: '2026-08-01T00:00:00Z',
  config: null,
  ...over,
});

describe('planBackfill', () => {
  const sessions = [
    s('old-20k', { config: { summarizer: { jobSlug: 'coach-compact', triggerTokens: 20_000 } } }),
    s('old-32k', { config: { summarizer: { jobSlug: 'coach-compact', triggerTokens: 32_000 } } }),
    s('recent-none', { updated_at: '2026-10-20T00:00:00Z' }),
    s('live', { config: { summarizer: { keepTailUnits: 12_000, triggerTokens: 42_000, jobSlug: 'coach-compact' } } }),
    s('idle-none'),
    s('other-job', { processing_job_id: 'job-other', config: { summarizer: { jobSlug: 'x' } } }),
    s('no-job', { processing_job_id: null, updated_at: '2026-10-20T00:00:00Z' }),
  ];
  const plan = planBackfill(sessions, { coachJobId: COACH, since: SINCE, policy: LIVE });

  it('rewrites coach sessions with an old summarizer, or none but recent activity', () => {
    expect(plan.toWrite.map((x) => x.id)).toEqual(['old-20k', 'old-32k', 'recent-none']);
    expect(plan.byTrigger).toEqual({ '20000': 1, '32000': 1, none: 1 });
  });

  it('near-misses: already live (any key order), idle with no summarizer, another job, no job', () => {
    expect(plan.alreadyLive).toBe(1);
    for (const id of ['live', 'idle-none', 'other-job', 'no-job']) {
      expect(plan.toWrite.map((x) => x.id)).not.toContain(id);
    }
  });

  it('replaces only the summarizer, keeping the rest of the config', () => {
    const cfg = withSummarizer(s('a', { config: { summarizer: { triggerTokens: 1 }, keep: true } }), LIVE);
    expect(cfg).toEqual({ keep: true, summarizer: LIVE });
  });
});
