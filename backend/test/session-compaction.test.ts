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

  it('estimateSessionTokens prefers session counters', () => {
    const session = { total_prompt_tokens: 100, total_completion_tokens: 50 } as ChatSessionRow;
    expect(estimateSessionTokens(session, [])).toBe(150);
  });
});
