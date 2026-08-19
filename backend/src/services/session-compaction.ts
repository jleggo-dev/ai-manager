/**
 * Session compaction — summarize older turns when context exceeds a token threshold.
 */

import type { ChatSessionRow, ChatMessageRow } from '../types.ts';
import { listChatMessages, updateChatSession } from '../models/chat-sessions.ts';
import { executeJob } from '../ai-manager/index.ts';
import { getProcessingJobBySlug } from '../models/processing-jobs.ts';
import { errorMessage } from '../lib/error-message.ts';

export interface SummarizerConfig {
  jobSlug: string;
  triggerTokens?: number;
  keepLastNTurns?: number;
}

/** Rough token estimate: ~4 chars per token (no tiktoken). */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function getSummarizerConfig(session: ChatSessionRow): SummarizerConfig | null {
  const config = session.config as { summarizer?: SummarizerConfig } | undefined;
  if (!config?.summarizer?.jobSlug) return null;
  return {
    jobSlug: config.summarizer.jobSlug,
    triggerTokens: config.summarizer.triggerTokens ?? 8000,
    keepLastNTurns: config.summarizer.keepLastNTurns ?? 6,
  };
}

/**
 * How big the NEXT request will be — which is the stored history, and nothing else.
 *
 * This used to prefer `total_prompt_tokens + total_completion_tokens`, and those are **cumulative
 * across every turn the session has ever taken**, not the size of the context. A real coach session
 * measured 2026-08-19 carried ~119k of actual history and reported **3,015,788** on those counters,
 * because each of its 82 turns added its own prompt again. Against the 8k default trigger that is
 * not a slight over-estimate: it means a session compacts on its second or third turn, forever, and
 * the summarizer bill arrives with it.
 *
 * The message contents ARE the request (see `buildSessionChatMessages`), so estimating from them is
 * both simpler and the only version that can be right. Cost of the change: char/4 is rough. Cost of
 * the old version: unbounded and silent.
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
 * and leave a coach who has forgotten she is one. Neither had ever happened only because no session
 * has ever had a summarizer configured.
 */
const isInstruction = (m: ChatMessageRow): boolean => m.role === 'system';

/**
 * If over threshold, run summarizer job over older turns and store session_summary.
 * Returns updated summary text (or existing).
 */
export async function maybeCompactSession(
  session: ChatSessionRow,
  callingApplication: string,
): Promise<{ summary: string | null; estimatedTokens: number; compacted: boolean }> {
  const summarizer = getSummarizerConfig(session);
  const messages = await listChatMessages(session.id);
  const estimatedTokens = estimateSessionTokens(session, messages);

  if (!summarizer) {
    return { summary: session.session_summary ?? null, estimatedTokens, compacted: false };
  }

  if (estimatedTokens < (summarizer.triggerTokens ?? 8000)) {
    return { summary: session.session_summary ?? null, estimatedTokens, compacted: false };
  }

  const keepN = summarizer.keepLastNTurns ?? 6;
  // Instructions are held out: they are not dialogue, and they are re-attached by
  // buildCompactedHistory on every read.
  const conversation = messages.filter((m) => !isInstruction(m));
  const toSummarize = conversation.slice(0, Math.max(0, conversation.length - keepN));
  if (toSummarize.length === 0) {
    return { summary: session.session_summary ?? null, estimatedTokens, compacted: false };
  }

  try {
    const transcript = toSummarize.map((m) => `${m.role}: ${m.content}`).join('\n\n');
    const job = await getProcessingJobBySlug(summarizer.jobSlug);
    if (!job) {
      console.warn('[session-compaction] summarizer job not found:', summarizer.jobSlug);
      return { summary: session.session_summary ?? null, estimatedTokens, compacted: false };
    }

    const result = await executeJob(summarizer.jobSlug, {
      callingApplication,
      variables: {
        transcript,
        existingSummary: session.session_summary || '',
      },
    });

    const summary = result.formatted || result.raw;
    await updateChatSession(session.id, { session_summary: summary });
    console.info('[session-compaction] compacted session', {
      sessionId: session.id,
      summarizedTurns: toSummarize.length,
      estimatedTokens,
    });
    return { summary, estimatedTokens, compacted: true };
  } catch (err) {
    console.warn('[session-compaction] failed:', errorMessage(err));
    return { summary: session.session_summary ?? null, estimatedTokens, compacted: false };
  }
}

/**
 * Build message history for LLM call: summary prefix + last N turns.
 */
export function buildCompactedHistory(
  session: ChatSessionRow,
  messages: ChatMessageRow[],
  summarizer: SummarizerConfig | null,
): ChatMessageRow[] {
  if (!session.session_summary) return messages;

  const keepN = summarizer?.keepLastNTurns ?? 6;
  // System rows first and always — a compacted session keeps its instructions verbatim and loses
  // only old dialogue. `id: 'summary'` is excluded so re-compaction never nests a summary of a
  // summary of a summary.
  const instructions = messages.filter((m) => isInstruction(m) && m.id !== 'summary');
  const recent = messages.filter((m) => !isInstruction(m)).slice(-keepN);
  const summaryMessage = {
    id: 'summary',
    chat_session_id: session.id,
    role: 'system',
    content: `[Conversation summary]\n${session.session_summary}`,
    created_at: new Date().toISOString(),
    workspace_id: session.workspace_id,
  } as ChatMessageRow;
  return [...instructions, summaryMessage, ...recent];
}
