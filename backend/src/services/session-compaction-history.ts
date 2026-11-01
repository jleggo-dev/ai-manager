/**
 * What a compacted session sends, rebuilt on every request: the policy types, the size estimate,
 * and `buildCompactedHistory`. Pure: no database, no model. `session-compaction-plan.ts` decides
 * what the next compaction folds; `session-compaction.ts` runs it.
 */

import type { ChatSessionRow, ChatMessageRow } from '../types.ts';

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
  /**
   * How many TURNS stay verbatim behind the summary. Rows matching `appRowPattern` don't count.
   * Used only when `keepTailUnits` is not set (sessions opened before it existed still carry this).
   */
  keepLastNTurns?: number;
  /**
   * How big the verbatim tail may be, in units, counting EVERY row in it (injected ones too),
   * because the point is the size of what is sent. Kept as whole exchanges, never fewer than the
   * last two. Wins over `keepLastNTurns`: a turn count lets a session whose injected rows are huge
   * keep a tail bigger than its trigger, and then it compacts on every message.
   */
  keepTailUnits?: number;
  /**
   * Skip a compaction that would take less than this many units out of the request: every fold
   * loses something, so folding two rows at a time is all cost. A round the transcript budget
   * filled always runs. Defaults to a tenth of the trigger.
   */
  minRemovedUnits?: number;
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
  /**
   * Regex source, with ONE capture group naming a source, for app rows that are written once in a
   * while and stay true until the next one (today's date, the last attachment note). Of the rows
   * behind the mark, the newest of each source is sent again, after the summary and before the
   * tail, unless the tail already holds a row from that source. Every older one is dropped.
   */
  keepNewestRowPattern?: string;
}

export type CompactionThreshold = 'trigger' | 'ceiling';

type OptionalPolicy =
  'appRowPattern' | 'pinnedRowPattern' | 'keepNewestRowPattern' | 'keepTailUnits' | 'minRemovedUnits';

/** The policy with its defaults filled in. The newer fields stay optional: older sessions lack them. */
export type ResolvedSummarizer = Required<Omit<SummarizerConfig, OptionalPolicy>> &
  Pick<SummarizerConfig, OptionalPolicy>;

/** Rough token estimate: ~4 chars per token (no tiktoken). */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * How big a list of messages is.
 *
 * This used to prefer `total_prompt_tokens + total_completion_tokens`, and those are **cumulative
 * across every turn the session has ever taken**, not the size of the context. A real coach session
 * measured 2026-08-19 carried ~119k of actual history and reported **3,015,788** on those counters,
 * because each of its 82 turns added its own prompt again. Callers pass the history that will be
 * SENT (`buildCompactedHistory`), never the stored archive — see session-compaction.ts for why.
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
export const isInstruction = (m: ChatMessageRow): boolean => m.role === 'system';

function compile(pattern: string | undefined): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern);
  } catch {
    console.warn('[session-compaction] ignoring invalid row pattern:', pattern);
    return null;
  }
}

/** A bad pattern in config must not take the conversation down with it — it just matches nothing. */
export function rowMatcher(pattern: string | undefined): (m: ChatMessageRow) => boolean {
  const re = compile(pattern);
  return re ? (m) => re.test(m.content ?? '') : () => false;
}

/** The source a `keepNewestRowPattern` row belongs to (its first capture group), or null. */
export function rowSource(pattern: string | undefined): (m: ChatMessageRow) => string | null {
  const re = compile(pattern);
  if (!re) return () => null;
  return (m) => {
    const match = re.exec(m.content ?? '');
    return match ? (match[1] ?? match[0]) : null;
  };
}

/**
 * The rows behind the mark that are sent again anyway: the newest of each `keepNewestRowPattern`
 * source, unless the tail already has one from that source. In their original order.
 */
export function newestPerSource(
  behind: ChatMessageRow[],
  tail: ChatMessageRow[],
  pattern: string | undefined,
): ChatMessageRow[] {
  const sourceOf = rowSource(pattern);
  const inTail = new Set(tail.map(sourceOf).filter((s): s is string => s !== null));
  const newest = new Map<string, ChatMessageRow>();
  for (const m of behind) {
    const source = sourceOf(m);
    if (source !== null && !inTail.has(source)) newest.set(source, m);
  }
  const keep = new Set(newest.values());
  return behind.filter((m) => keep.has(m));
}

/**
 * Build message history for the LLM call: instructions + pinned rows + summary + the newest row of
 * each kept source + every row after the mark. Other rows before the mark are gone from the
 * request (still stored, still the audit trail): dialogue lives on in the summary, app rows are the
 * app's to send again.
 *
 * On the wire the order differs: the Responses dialect (`buildResponsesRequest`, used by Devs.ai v2
 * and the gateway) lifts EVERY system row into `instructions`, so the summary rides there with the
 * persona, ahead of the pinned rows, which are the first input items.
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
  const isPinned = rowMatcher(summarizer?.pinnedRowPattern);
  const mark = session.summary_through_at ? Date.parse(session.summary_through_at) : null;
  const marked = mark !== null && Number.isFinite(mark);
  const recent = marked
    ? conversation.filter((m) => Date.parse(m.created_at) > mark)
    : conversation.slice(-(summarizer?.keepLastNTurns ?? 6));
  // Pinned rows the tail does not already carry, in their original order (MP33: the capability
  // manifest and pick protocol used to be summarized away mid-session).
  const kept = new Set(recent);
  const pinned = conversation.filter((m) => isPinned(m) && !kept.has(m));
  const behind = marked ? conversation.filter((m) => !kept.has(m) && !isPinned(m)) : [];
  const survivors = newestPerSource(behind, recent, summarizer?.keepNewestRowPattern);
  const summaryMessage = {
    id: 'summary',
    chat_session_id: session.id,
    role: 'system',
    content: `[Conversation summary]\n${session.session_summary}`,
    created_at: new Date().toISOString(),
    workspace_id: session.workspace_id,
  } as ChatMessageRow;
  return [...instructions, ...pinned, summaryMessage, ...survivors, ...recent];
}
