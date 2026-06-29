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

/** Estimate total tokens for a session from stored usage + message content. */
export function estimateSessionTokens(session: ChatSessionRow, messages: ChatMessageRow[]): number {
  const fromCounters = (session.total_prompt_tokens || 0) + (session.total_completion_tokens || 0);
  if (fromCounters > 0) return fromCounters;
  return messages.reduce((sum, m) => sum + estimateTokenCount(m.content || ''), 0);
}

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
  const toSummarize = messages.slice(0, Math.max(0, messages.length - keepN));
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
  const recent = messages.slice(-keepN);
  const summaryMessage = {
    id: 'summary',
    chat_session_id: session.id,
    role: 'system',
    content: `[Conversation summary]\n${session.session_summary}`,
    created_at: new Date().toISOString(),
    workspace_id: session.workspace_id,
  } as ChatMessageRow;
  return [summaryMessage, ...recent];
}
