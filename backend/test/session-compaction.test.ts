import { describe, it, expect } from 'vitest';
import {
  estimateTokenCount,
  getSummarizerConfig,
  buildCompactedHistory,
  estimateSessionTokens,
} from '../src/services/session-compaction.ts';
import type { ChatSessionRow, ChatMessageRow } from '../src/types.ts';

describe('session-compaction', () => {
  it('estimateTokenCount uses char/4 heuristic', () => {
    expect(estimateTokenCount('hello world')).toBe(3);
  });

  it('getSummarizerConfig reads session.config.summarizer', () => {
    const session = {
      config: { summarizer: { jobSlug: 'summarize-chat', triggerTokens: 5000, keepLastNTurns: 4 } },
    } as unknown as ChatSessionRow;
    const cfg = getSummarizerConfig(session);
    expect(cfg?.jobSlug).toBe('summarize-chat');
    expect(cfg?.triggerTokens).toBe(5000);
  });

  it('buildCompactedHistory prepends summary and keeps last N turns', () => {
    const session = { id: 's1', session_summary: 'User discussed goals.' } as unknown as ChatSessionRow;
    const messages = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      chat_session_id: 's1',
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg ${i}`,
      created_at: new Date().toISOString(),
    })) as ChatMessageRow[];

    const compacted = buildCompactedHistory(session, messages, { jobSlug: 'x', keepLastNTurns: 4 });
    expect(compacted[0]?.role).toBe('system');
    expect(compacted[0]?.content).toContain('User discussed goals');
    expect(compacted.length).toBe(5); /* summary + 4 recent */
  });

  /**
   * The session's instructions are not its conversation.
   *
   * A job-bound session stores its system prompt as a `role:'system'` row at open, so for Cadence's
   * coach that row IS her persona. Compacting used to take `messages.slice(-keepN)`, which would
   * have deleted it the first time a summary existed — a coach who has forgotten she is one, three
   * days into a conversation. It never bit anyone only because no session has ever had a summarizer
   * configured (0 of 251 on 2026-08-19).
   */
  it('buildCompactedHistory keeps the system prompt, and does not count it as a turn', () => {
    const session = { id: 's1', session_summary: 'Earlier: goals and constraints.' } as unknown as ChatSessionRow;
    const persona = {
      id: 'sys',
      chat_session_id: 's1',
      role: 'system',
      content: 'You are Cadence, a warm, specific coach.',
      created_at: new Date().toISOString(),
    } as ChatMessageRow;
    const turns = Array.from({ length: 8 }, (_, i) => ({
      id: `m${i}`,
      chat_session_id: 's1',
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg ${i}`,
      created_at: new Date().toISOString(),
    })) as ChatMessageRow[];

    const compacted = buildCompactedHistory(session, [persona, ...turns], { jobSlug: 'x', keepLastNTurns: 4 });

    expect(compacted[0]?.content).toContain('You are Cadence');
    expect(compacted[1]?.content).toContain('Earlier: goals and constraints');
    // persona + summary + the last FOUR turns — the persona must not eat one of the kept turns.
    expect(compacted.length).toBe(6);
    expect(compacted.slice(2).map((m) => m.content)).toEqual(['msg 4', 'msg 5', 'msg 6', 'msg 7']);
  });

  it('buildCompactedHistory never nests a summary of a summary', () => {
    const session = { id: 's1', session_summary: 'New summary.' } as unknown as ChatSessionRow;
    const stale = {
      id: 'summary',
      chat_session_id: 's1',
      role: 'system',
      content: '[Conversation summary]\nOld summary.',
      created_at: new Date().toISOString(),
    } as ChatMessageRow;

    const compacted = buildCompactedHistory(session, [stale], { jobSlug: 'x', keepLastNTurns: 4 });
    expect(compacted).toHaveLength(1);
    expect(compacted[0]?.content).toContain('New summary');
    expect(compacted[0]?.content).not.toContain('Old summary');
  });

  /**
   * `total_prompt_tokens` is CUMULATIVE over every turn, not the size of the next request. A real
   * coach session carrying ~119k of history reported 3,015,788 on those counters (2026-08-19),
   * which against the 8k default trigger means compacting on turn two, forever. The messages are
   * the request, so they are what gets measured.
   */
  it('estimateSessionTokens measures the history, not the lifetime counters', () => {
    const session = { total_prompt_tokens: 3_015_788, total_completion_tokens: 40_000 } as ChatSessionRow;
    const messages = [{ content: 'a'.repeat(400) }, { content: 'b'.repeat(400) }] as ChatMessageRow[];

    expect(estimateSessionTokens(session, messages)).toBe(200);
    expect(estimateSessionTokens(session, [])).toBe(0);
  });
});
