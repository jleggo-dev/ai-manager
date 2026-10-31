/**
 * Session compaction — summarize older turns when the history sent to the model gets too big.
 *
 * The shape, after a first compaction: instructions + `[Conversation summary]` + every row after
 * `summary_through_at`. When THAT passes the trigger, the oldest of those rows are folded into the
 * summary and the mark moves forward. Three rules, each the fix for a measured defect (2026-10-31,
 * docs/cadence/HARNESS-V3.md C1):
 *
 *  - **Measure what will be sent**, not every stored row. Rows are never deleted, so measuring the
 *    archive kept a session over its trigger forever once it crossed it: every later message
 *    re-summarized the whole older conversation (3 runs in 3 sends, 2026-08-31).
 *  - **Summarize only what is new** since the mark, folded into the existing summary.
 *  - **Count turns, not rows**, for the kept tail. An app that injects context rows beside each
 *    message (`appRowPattern`) otherwise keeps a third as many turns as it asked for.
 *
 * WHEN it runs is the caller's: `compactSessionAfterReply` after the reply is on file (nobody
 * waits), and `maybeCompactSession(…, 'ceiling')` before a send as the synchronous safety net.
 */

import type { ChatSessionRow, ChatMessageRow } from '../types.ts';
import { getChatSession, listChatMessages, updateChatSession } from '../models/chat-sessions.ts';
import { executeJob } from '../ai-manager/index.ts';
import { getProcessingJobBySlug } from '../models/processing-jobs.ts';
import { errorMessage } from '../lib/error-message.ts';
import { v2ThreadingEnabled } from './ai-profile-runtime-options.ts';

export interface SummarizerConfig {
  jobSlug: string;
  /** Compact once the history to be sent reaches this many units (chars/4). */
  triggerTokens?: number;
  /**
   * Compact BEFORE a send once the history reaches this. Defaults to `triggerTokens`, which is the
   * whole policy for a caller with no after-reply hook. A caller that compacts after each reply
   * sets it higher, so a send only waits on a summarizer when the after-reply run did not land.
   */
  ceilingTokens?: number;
  /** How many TURNS stay verbatim behind the summary. Rows matching `appRowPattern` don't count. */
  keepLastNTurns?: number;
  /**
   * Regex source for rows the calling app wrote into the conversation (injected context, notes).
   * They don't count as turns, and at compaction they are DROPPED, not summarized: they are the
   * app's own data, which it can send again, and a summarizer reading them would take them for
   * something the user said.
   */
  appRowPattern?: string;
  /**
   * Regex source for app rows that are sent ONCE and must outlive every compaction (instructions
   * delivered as conversation, e.g. a capability manifest). Kept verbatim like system rows.
   */
  pinnedRowPattern?: string;
}

export type CompactionThreshold = 'trigger' | 'ceiling';

/** The policy with its defaults filled in. */
export type ResolvedSummarizer = Required<Omit<SummarizerConfig, 'appRowPattern' | 'pinnedRowPattern'>> &
  Pick<SummarizerConfig, 'appRowPattern' | 'pinnedRowPattern'>;

/** Rough token estimate: ~4 chars per token (no tiktoken). */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function getSummarizerConfig(session: ChatSessionRow): ResolvedSummarizer | null {
  const config = session.config as { summarizer?: SummarizerConfig } | undefined;
  if (!config?.summarizer?.jobSlug) return null;
  const triggerTokens = config.summarizer.triggerTokens ?? 8000;
  return {
    jobSlug: config.summarizer.jobSlug,
    triggerTokens,
    ceilingTokens: Math.max(config.summarizer.ceilingTokens ?? triggerTokens, triggerTokens),
    keepLastNTurns: config.summarizer.keepLastNTurns ?? 6,
    appRowPattern: config.summarizer.appRowPattern,
    pinnedRowPattern: config.summarizer.pinnedRowPattern,
  };
}

/**
 * How big a list of messages is.
 *
 * This used to prefer `total_prompt_tokens + total_completion_tokens`, and those are **cumulative
 * across every turn the session has ever taken**, not the size of the context. A real coach session
 * measured 2026-08-19 carried ~119k of actual history and reported **3,015,788** on those counters,
 * because each of its 82 turns added its own prompt again. Callers pass the history that will be
 * SENT (`buildCompactedHistory`), never the stored archive — see the file header for why.
 */
export function estimateSessionTokens(_session: ChatSessionRow, messages: ChatMessageRow[]): number {
  return messages.reduce((sum, m) => sum + estimateTokenCount(m.content || ''), 0);
}

/**
 * The session's INSTRUCTIONS, which are not part of its conversation.
 *
 * A job-bound session stores its system prompt as a `role:'system'` row at open
 * (`chat-session-open.ts`), so for Cadence's coach that row IS her persona — ~20k characters of it.
 * Both halves of compaction have to know that: summarizing it would feed her own instructions to a
 * summarizer as if they were dialogue, and dropping it would delete her personality mid-conversation
 * and leave a coach who has forgotten she is one.
 */
const isInstruction = (m: ChatMessageRow): boolean => m.role === 'system';

/** A bad pattern in config must not take the conversation down with it — it just matches nothing. */
function rowMatcher(pattern: string | undefined): (m: ChatMessageRow) => boolean {
  if (!pattern) return () => false;
  try {
    const re = new RegExp(pattern);
    return (m) => re.test(m.content ?? '');
  } catch {
    console.warn('[session-compaction] ignoring invalid row pattern:', pattern);
    return () => false;
  }
}

/**
 * Split the uncompacted rows into what gets summarized and what stays verbatim.
 *
 * Counts back `keepN` real turns. App rows sitting just before the first kept turn stay with it —
 * they are that turn's context, and summarizing them away would leave the turn without it.
 */
export function splitForCompaction(
  pending: ChatMessageRow[],
  keepN: number,
  appRowPattern?: string,
): { toSummarize: ChatMessageRow[]; kept: ChatMessageRow[] } {
  const isAppRow = rowMatcher(appRowPattern);
  let cut = pending.length;
  let turns = 0;
  while (cut > 0 && turns < keepN) {
    cut -= 1;
    const m = pending[cut];
    if (m && !isAppRow(m)) turns += 1;
  }
  if (turns < keepN) return { toSummarize: [], kept: pending };
  for (let prev = pending[cut - 1]; prev && isAppRow(prev); prev = pending[cut - 1]) cut -= 1;
  return { toSummarize: pending.slice(0, cut), kept: pending.slice(cut) };
}

/**
 * Build message history for the LLM call: instructions + pinned rows + summary + every row after
 * the mark. Unpinned rows before the mark are gone from the request (still stored, still the audit
 * trail): dialogue lives on in the summary, app rows are the app's to send again.
 *
 * A session summarized before `summary_through_at` existed has a summary and no mark; it keeps the
 * old shape (summary + last N rows) rather than suddenly re-sending its whole archive.
 */
export function buildCompactedHistory(
  session: ChatSessionRow,
  messages: ChatMessageRow[],
  summarizer: SummarizerConfig | null,
): ChatMessageRow[] {
  if (!session.session_summary) return messages;

  // System rows first and always — a compacted session keeps its instructions verbatim and loses
  // only old dialogue. `id: 'summary'` is excluded so re-compaction never nests a summary of a
  // summary of a summary.
  const instructions = messages.filter((m) => isInstruction(m) && m.id !== 'summary');
  const conversation = messages.filter((m) => !isInstruction(m));
  const mark = session.summary_through_at ? Date.parse(session.summary_through_at) : null;
  const recent =
    mark !== null && Number.isFinite(mark)
      ? conversation.filter((m) => Date.parse(m.created_at) > mark)
      : conversation.slice(-(summarizer?.keepLastNTurns ?? 6));
  // Pinned rows the tail does not already carry, in their original order (MP33: the capability
  // manifest and pick protocol used to be summarized away mid-session).
  const isPinned = rowMatcher(summarizer?.pinnedRowPattern);
  const kept = new Set(recent);
  const pinned = conversation.filter((m) => isPinned(m) && !kept.has(m));
  const summaryMessage = {
    id: 'summary',
    chat_session_id: session.id,
    role: 'system',
    content: `[Conversation summary]\n${session.session_summary}`,
    created_at: new Date().toISOString(),
    workspace_id: session.workspace_id,
  } as ChatMessageRow;
  return [...instructions, ...pinned, summaryMessage, ...recent];
}

interface CompactionResult {
  summary: string | null;
  estimatedTokens: number;
  compacted: boolean;
}

/** What one compaction would do: the summarizer's input and where the mark moves to. */
export interface CompactionPlan {
  estimatedTokens: number;
  /** The summarizer's `transcript` variable: the dialogue rows, `role: content`, blank-line joined. */
  transcript: string;
  summarizedRows: number;
  droppedAppRows: number;
  /** The new `summary_through_at`. */
  through: string;
}

/**
 * Decide whether a history needs compacting and, if so, exactly what gets summarized. Pure — the
 * same function the live path and `eval-compaction.ts` run, so the eval measures what production
 * does. Returns `{ estimatedTokens }` alone when nothing is due.
 */
export function planCompaction(
  session: ChatSessionRow,
  messages: ChatMessageRow[],
  summarizer: ResolvedSummarizer,
  threshold: CompactionThreshold,
): CompactionPlan | { estimatedTokens: number; transcript?: undefined } {
  const sent = buildCompactedHistory(session, messages, summarizer);
  const estimatedTokens = estimateSessionTokens(session, sent);
  const limit = threshold === 'ceiling' ? summarizer.ceilingTokens : summarizer.triggerTokens;
  if (estimatedTokens < limit) return { estimatedTokens };

  // Instructions, pinned rows and the summary row are held out: buildCompactedHistory re-attaches them.
  const isPinned = rowMatcher(summarizer.pinnedRowPattern);
  const pending = sent.filter((m) => !isInstruction(m) && !isPinned(m));
  const { toSummarize } = splitForCompaction(pending, summarizer.keepLastNTurns, summarizer.appRowPattern);
  const last = toSummarize[toSummarize.length - 1];
  if (!last) return { estimatedTokens };

  // App rows are dropped, not summarized (see `appRowPattern`). `dialogue` is never empty:
  // splitForCompaction keeps the app rows that lead into the first kept turn, so `toSummarize`
  // always ends on a real turn.
  const isAppRow = rowMatcher(summarizer.appRowPattern);
  const dialogue = toSummarize.filter((m) => !isAppRow(m));
  return {
    estimatedTokens,
    transcript: dialogue.map((m) => `${m.role}: ${m.content}`).join('\n\n'),
    summarizedRows: dialogue.length,
    droppedAppRows: toSummarize.length - dialogue.length,
    through: last.created_at,
  };
}

/**
 * If the history to be sent is over the threshold, fold its oldest rows into the summary.
 * Returns the current summary either way; a failure is logged and leaves the session untouched.
 */
export async function maybeCompactSession(
  session: ChatSessionRow,
  callingApplication: string,
  threshold: CompactionThreshold = 'trigger',
): Promise<CompactionResult> {
  const summarizer = getSummarizerConfig(session);
  const messages = await listChatMessages(session.id);
  if (!summarizer) {
    const estimatedTokens = estimateSessionTokens(session, buildCompactedHistory(session, messages, null));
    return { summary: session.session_summary ?? null, estimatedTokens, compacted: false };
  }
  const plan = planCompaction(session, messages, summarizer, threshold);
  const unchanged = {
    summary: session.session_summary ?? null,
    estimatedTokens: plan.estimatedTokens,
    compacted: false,
  };
  if (plan.transcript === undefined) return unchanged;

  try {
    const job = await getProcessingJobBySlug(summarizer.jobSlug);
    if (!job) {
      console.warn('[session-compaction] summarizer job not found:', summarizer.jobSlug);
      return unchanged;
    }

    const result = await executeJob(summarizer.jobSlug, {
      callingApplication,
      variables: { transcript: plan.transcript, existingSummary: session.session_summary || '' },
    });

    const summary = result.formatted || result.raw;
    await updateChatSession(session.id, {
      session_summary: summary,
      summary_through_at: plan.through,
    });
    console.info('[session-compaction] compacted session', {
      sessionId: session.id,
      threshold,
      summarizedRows: plan.summarizedRows,
      droppedAppRows: plan.droppedAppRows,
      estimatedTokens: plan.estimatedTokens,
    });
    return { summary, estimatedTokens: plan.estimatedTokens, compacted: true };
  } catch (err) {
    console.warn('[session-compaction] failed:', errorMessage(err));
    return unchanged;
  }
}

/**
 * Compact after a reply is on file, so the summarizer's ~6 s lands on nobody's wait.
 *
 * Callers on serverless must keep the invocation alive for it (await it after the response has
 * ended, or hand it to `waitUntil`). Never throws: the reply it follows is already delivered.
 * Threaded sessions are skipped for the same reason as before a send — the provider holds and
 * budgets their history, so shrinking our local copy would buy nothing.
 */
export async function compactSessionAfterReply(sessionId: string, callingApplication: string): Promise<void> {
  try {
    const session = await getChatSession(sessionId);
    if (!session || !getSummarizerConfig(session)) return;
    if (v2ThreadingEnabled(session.provider_type ?? '', session.ai_profile?.runtime_options || {})) return;
    await maybeCompactSession(session, callingApplication, 'trigger');
  } catch (err) {
    console.warn('[session-compaction] after-reply failed:', errorMessage(err));
  }
}
