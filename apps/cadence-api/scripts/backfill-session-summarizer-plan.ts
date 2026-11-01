/**
 * The pure half of `backfill-session-summarizer.ts`: which sessions get the live policy, and the
 * dry-run counts. No database here, so it is tested on its own.
 */

/** The fields of a chat session the backfill reads. */
export interface BackfillSession {
  id: string;
  processing_job_id?: string | null;
  updated_at?: string | null;
  config?: Record<string, unknown> | null;
}

export interface BackfillPlan {
  /** Sessions whose summarizer will be replaced by the live policy. */
  toWrite: BackfillSession[];
  /** Sessions already carrying the live policy exactly. */
  alreadyLive: number;
  /** What the sessions to write carry today, by trigger (`none` = no summarizer at all). */
  byTrigger: Record<string, number>;
}

const summarizerOf = (s: BackfillSession) =>
  (s.config as { summarizer?: Record<string, unknown> } | null | undefined)?.summarizer;

/** Key order does not make two policies different. */
const canonical = (v: unknown): string =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? `{${Object.keys(v)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
        .join(',')}}`
    : JSON.stringify(v);

/**
 * The coach's sessions (bound to the coach job, so a Cadence session for anything else is never
 * touched) that carry a summarizer of any vintage, or were active since `since`. Those already on
 * the live policy are counted, not rewritten.
 */
export function planBackfill(
  sessions: BackfillSession[],
  opts: { coachJobId: string; since: string; policy: Record<string, unknown> },
): BackfillPlan {
  const since = Date.parse(opts.since);
  const live = canonical(opts.policy);
  const plan: BackfillPlan = { toWrite: [], alreadyLive: 0, byTrigger: {} };
  for (const s of sessions) {
    if (s.processing_job_id !== opts.coachJobId) continue;
    const current = summarizerOf(s);
    const recent = Date.parse(s.updated_at ?? '') >= since;
    if (!current && !recent) continue;
    if (current && canonical(current) === live) {
      plan.alreadyLive += 1;
      continue;
    }
    const trigger = current ? String(current.triggerTokens ?? 'unset') : 'none';
    plan.byTrigger[trigger] = (plan.byTrigger[trigger] ?? 0) + 1;
    plan.toWrite.push(s);
  }
  return plan;
}

/** The session's config with only `summarizer` replaced; every other key is kept. */
export const withSummarizer = (s: BackfillSession, policy: Record<string, unknown>): Record<string, unknown> => ({
  ...(s.config ?? {}),
  summarizer: policy,
});
