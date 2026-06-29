/**
 * Unit tests – resumeChatSessionSchema
 * -------------------------------------
 * Pure validation tests for the resume request body. No DB or network.
 * Behavioral branches of resumeChatSession itself are covered by the
 * integration suite (chat-sessions-resume.test.ts) against a live DB.
 */
import { describe, it, expect } from 'vitest';
import { resumeChatSessionSchema } from '../src/schemas/chat-sessions.ts';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('resumeChatSessionSchema', () => {
  it('accepts a sessionId alone', () => {
    const parsed = resumeChatSessionSchema.safeParse({ sessionId: VALID_UUID });
    expect(parsed.success).toBe(true);
  });

  it('accepts an externalChatId alone', () => {
    const parsed = resumeChatSessionSchema.safeParse({ externalChatId: 'devs-ai-chat-123' });
    expect(parsed.success).toBe(true);
  });

  it('accepts both ids together', () => {
    const parsed = resumeChatSessionSchema.safeParse({
      sessionId: VALID_UUID,
      externalChatId: 'devs-ai-chat-123',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts the optional fallbackToLocal flag', () => {
    const parsed = resumeChatSessionSchema.safeParse({
      externalChatId: 'devs-ai-chat-123',
      fallbackToLocal: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects when neither id is provided', () => {
    const parsed = resumeChatSessionSchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toMatch(/sessionId or externalChatId/i);
    }
  });

  it('rejects an empty externalChatId', () => {
    const parsed = resumeChatSessionSchema.safeParse({ externalChatId: '' });
    expect(parsed.success).toBe(false);
  });

  it('rejects a non-UUID sessionId', () => {
    const parsed = resumeChatSessionSchema.safeParse({ sessionId: 'not-a-uuid' });
    expect(parsed.success).toBe(false);
  });

  it('rejects a non-boolean fallbackToLocal', () => {
    const parsed = resumeChatSessionSchema.safeParse({
      sessionId: VALID_UUID,
      fallbackToLocal: 'yes',
    });
    expect(parsed.success).toBe(false);
  });
});
