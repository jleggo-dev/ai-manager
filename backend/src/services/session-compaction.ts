/**
 * Session compaction — summarize older turns when the history sent to the model gets too big.
 *
 * The shape, after a first compaction: instructions + `[Conversation summary]` + every row after
 * `summary_through_at`. When THAT passes the trigger, the oldest of those rows are folded into the
 * summary and the mark moves forward. The rules, each the fix for a measured defect
 * (docs/cadence/HARNESS-V3.md C1, C2 and P1b):
 *
 *  - **Measure what will be sent**, not every stored row. Rows are never deleted, so measuring the
 *    archive kept a session over its trigger forever once it crossed it: every later message
 *    re-summarized the whole older conversation (3 runs in 3 sends, 2026-08-31).
 *  - **Summarize only what is new** since the mark, folded into the existing summary.
 *  - **Size the kept tail in units** (`keepTailUnits`); a turn count let huge injected rows keep a
 *    tail bigger than the trigger, and then every message compacted.
 *  - **Never move the mark past what the summarizer read.** A round's transcript is capped at the
 *    job-variable limit; rows past it stay after the mark for the next round.
 *  - **Skip a fold not worth its loss** (`minRemovedUnits`), and **never move the mark backwards**
 *    (the write is compare-and-set on the mark the plan was built from).
 *
 * The planning is pure and lives in `session-compaction-plan.ts` (the eval runs it too); the
 * history it plans over is `session-compaction-history.ts`. WHEN it runs is the caller's:
 * `compactSessionAfterReply` after the reply is on file (nobody waits), and
 * `maybeCompactSession(…, 'ceiling')` before a send as the synchronous safety net.
 */

import type { ChatSessionRow } from '../types.ts';
import { getChatSession, listChatMessages, updateChatSessionIfMarkUnchanged } from '../models/chat-sessions.ts';
import { executeJob } from '../ai-manager/index.ts';
import { getProcessingJobBySlug } from '../models/processing-jobs.ts';
import { errorMessage } from '../lib/error-message.ts';
import { v2ThreadingEnabled } from './ai-profile-runtime-options.ts';
import {
  buildCompactedHistory,
  estimateSessionTokens,
  type CompactionThreshold,
  type ResolvedSummarizer,
  type SummarizerConfig,
} from './session-compaction-history.ts';
import { planCompaction, type CompactionPlan } from './session-compaction-plan.ts';

export {
  estimateTokenCount,
  estimateSessionTokens,
  buildCompactedHistory,
  type SummarizerConfig,
  type ResolvedSummarizer,
  type CompactionThreshold,
} from './session-compaction-history.ts';
export {
  planCompaction,
  splitForCompaction,
  splitTailByUnits,
  cutTranscript,
  TRANSCRIPT_BUDGET_CHARS,
  type CompactionPlan,
  type NoCompaction,
} from './session-compaction-plan.ts';

/**
 * How many rounds one after-reply run may do. Nobody is waiting, so a backlog the transcript
 * budget split into several rounds catches up here instead of over the next few messages; the cap
 * keeps one run's invocation time bounded (~6 s a round).
 */
export const AFTER_REPLY_MAX_ROUNDS = 3;

export function getSummarizerConfig(session: ChatSessionRow): ResolvedSummarizer | null {
  const config = session.config as { summarizer?: SummarizerConfig } | undefined;
  if (!config?.summarizer?.jobSlug) return null;
  const s = config.summarizer;
  const triggerTokens = s.triggerTokens ?? 8000;
  return {
    jobSlug: s.jobSlug,
    triggerTokens,
    ceilingTokens: Math.max(s.ceilingTokens ?? triggerTokens, triggerTokens),
    keepLastNTurns: s.keepLastNTurns ?? 6,
    keepTailUnits: s.keepTailUnits,
    minRemovedUnits: s.minRemovedUnits,
    appRowPattern: s.appRowPattern,
    pinnedRowPattern: s.pinnedRowPattern,
    keepNewestRowPattern: s.keepNewestRowPattern,
  };
}

interface CompactionResult {
  summary: string | null;
  estimatedTokens: number;
  compacted: boolean;
  /** The round was cut short by the transcript budget: more is waiting to be folded. */
  budgetCut?: boolean;
}

/** Run the summarizer on one plan and write the result, if the mark is still where it was. */
async function foldOnce(
  session: ChatSessionRow,
  summarizer: ResolvedSummarizer,
  plan: CompactionPlan,
  callingApplication: string,
  threshold: CompactionThreshold,
): Promise<CompactionResult | null> {
  const sessionId = session.id;
  const job = await getProcessingJobBySlug(summarizer.jobSlug);
  if (!job) {
    console.warn('[session-compaction] summarizer job not found:', { sessionId, jobSlug: summarizer.jobSlug });
    return null;
  }
  const facts = {
    threshold,
    summarizedRows: plan.summarizedRows,
    droppedAppRows: plan.droppedAppRows,
    transcriptChars: plan.transcriptChars,
    budgetCut: plan.budgetCut,
    removedUnits: plan.removedUnits,
    estimatedTokens: plan.estimatedTokens,
  };
  const result = await executeJob(summarizer.jobSlug, {
    callingApplication,
    variables: { transcript: plan.transcript, existingSummary: session.session_summary || '' },
    diagnostics: { chatSessionId: sessionId, metadata: { compaction: facts } },
  });

  const summary = result.formatted || result.raw;
  const written = await updateChatSessionIfMarkUnchanged(
    sessionId,
    { session_summary: summary, summary_through_at: plan.through },
    session.summary_through_at ?? null,
  );
  if (!written) {
    // Another run moved the mark while this one was summarizing. Its summary covers more (or the
    // same) ground; writing this one would move the mark backwards.
    console.info('[session-compaction] skipped: the mark moved during the run', { sessionId, threshold });
    return null;
  }
  console.info('[session-compaction] compacted session', { sessionId, ...facts });
  return { summary, estimatedTokens: plan.estimatedTokens, compacted: true, budgetCut: plan.budgetCut };
}

/**
 * If the history to be sent is over the threshold, fold its oldest rows into the summary — one
 * round. Returns the current summary either way; a failure is logged (with the session id) and
 * leaves the session untouched.
 */
export async function maybeCompactSession(
  session: ChatSessionRow,
  callingApplication: string,
  threshold: CompactionThreshold = 'trigger',
): Promise<CompactionResult> {
  const sessionId = session.id;
  const summarizer = getSummarizerConfig(session);
  let unchanged: CompactionResult = { summary: session.session_summary ?? null, estimatedTokens: 0, compacted: false };
  try {
    const messages = await listChatMessages(sessionId);
    if (!summarizer) {
      const sent = buildCompactedHistory(session, messages, null);
      return { ...unchanged, estimatedTokens: estimateSessionTokens(session, sent) };
    }
    const plan = planCompaction(session, messages, summarizer, threshold);
    unchanged = { ...unchanged, estimatedTokens: plan.estimatedTokens };
    if (plan.transcript === undefined) {
      if (plan.skipped) {
        (plan.loud ? console.warn : console.info)('[session-compaction] skipped:', plan.skipped, { sessionId, threshold });
      }
      return unchanged;
    }
    return (await foldOnce(session, summarizer, plan, callingApplication, threshold)) ?? unchanged;
  } catch (err) {
    console.warn('[session-compaction] failed:', errorMessage(err), { sessionId, threshold });
    return unchanged;
  }
}

/**
 * Compact after a reply is on file, so the summarizer's ~6 s lands on nobody's wait. Goes again
 * (up to `AFTER_REPLY_MAX_ROUNDS`) while the transcript budget is what stopped the last round.
 *
 * Callers on serverless must keep the invocation alive for it (hand it to `waitUntil`). Never
 * throws: the reply it follows is already delivered. Threaded sessions are skipped for the same
 * reason as before a send — the provider holds and budgets their history, so shrinking our local
 * copy would buy nothing.
 */
export async function compactSessionAfterReply(sessionId: string, callingApplication: string): Promise<void> {
  try {
    let session = await getChatSession(sessionId);
    if (!session || !getSummarizerConfig(session)) return;
    if (v2ThreadingEnabled(session.provider_type ?? '', session.ai_profile?.runtime_options || {})) return;
    for (let round = 0; round < AFTER_REPLY_MAX_ROUNDS && session; round++) {
      const result = await maybeCompactSession(session, callingApplication, 'trigger');
      if (!result.compacted || !result.budgetCut) return;
      session = await getChatSession(sessionId);
    }
  } catch (err) {
    console.warn('[session-compaction] after-reply failed:', errorMessage(err), { sessionId });
  }
}
