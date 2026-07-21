/**
 * Characterization unit tests — chat-session lifecycle hot paths.
 * ----------------------------------------------------------------
 * Behavior lock before structural peels of chat-session-lifecycle.ts.
 * Mocks models/integrations; no live LLM / soft-cleanup race.
 *
 * Covers:
 *   - resume: not-found, already-active (no 409), closed→reactivate,
 *     remote-gone → "no longer available" (route maps to 409, not 404),
 *     fallbackToLocal
 *   - close: missing session, idempotent re-close
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiProfileRow, ChatMessageRow, ChatSessionRow, ProviderRow } from '../src/types.ts';

vi.mock('../src/models/processing-jobs.ts', () => ({
  getProcessingJobBySlug: vi.fn(),
  getProcessingJob: vi.fn(),
  updateProcessingJob: vi.fn(),
}));

vi.mock('../src/models/calling-applications.ts', () => ({
  upsertCallingApplication: vi.fn().mockResolvedValue({ id: 'app-1' }),
}));

vi.mock('../src/models/ai-profiles.ts', () => ({
  getAiProfileWithKeys: vi.fn(),
  hydrateAiProfileProviderKeys: vi.fn((profile: unknown) => profile),
}));

vi.mock('../src/models/workflows.ts', () => ({
  getWorkflow: vi.fn(),
  getWorkflowBySlug: vi.fn(),
  listWorkflowSteps: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/models/user-provider-credentials.ts', () => ({
  getUserCredential: vi.fn(),
}));

vi.mock('../src/models/chat-sessions.ts', () => ({
  createChatSession: vi.fn(),
  getChatSession: vi.fn(),
  getChatSessionByExternalChatId: vi.fn(),
  updateChatSession: vi.fn(),
  reactivateChatSession: vi.fn(),
  deleteChatSession: vi.fn(),
  createChatMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
  listChatMessages: vi.fn().mockResolvedValue([]),
  deleteChatMessages: vi.fn(),
  incrementSessionCounters: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/integrations/client-factory.ts', () => ({
  createLlmClientForProvider: vi.fn(),
  createLlmClientForUser: vi.fn(),
}));

const mockGetChatSession = vi.fn();

vi.mock('../src/integrations/devs-ai/client.ts', () => ({
  DevsAiClient: vi.fn().mockImplementation(function DevsAiClientMock() {
    return { getChatSession: mockGetChatSession };
  }),
}));

vi.mock('../src/integrations/devs-ai-v2/client.ts', () => ({
  DevsAiV2Client: vi.fn().mockImplementation(function DevsAiV2ClientMock() {
    return { getResponse: vi.fn() };
  }),
}));

vi.mock('../src/db/tenant.ts', () => ({
  getAuthContext: vi.fn(() => undefined),
  effectiveUserId: vi.fn(() => null),
  requireWorkspaceId: vi.fn(() => 'ws-1'),
  tenantFrom: vi.fn(),
}));

import { resumeChatSession, closeChatSession } from '../src/ai-manager/chat-session-lifecycle.ts';
import {
  getChatSession,
  getChatSessionByExternalChatId,
  updateChatSession,
  reactivateChatSession,
  listChatMessages,
} from '../src/models/chat-sessions.ts';
import { getAiProfileWithKeys } from '../src/models/ai-profiles.ts';
import { createLlmClientForProvider } from '../src/integrations/client-factory.ts';
import { getAuthContext, effectiveUserId } from '../src/db/tenant.ts';

const asProvider = (overrides: Partial<ProviderRow> = {}): ProviderRow =>
  ({
    id: 'prov-1',
    name: 'Primary Provider',
    type: 'devs-ai',
    base_url: 'https://api.devs.ai',
    api_key: 'primary-key',
    is_active: true,
    created_at: '2024-01-01',
    workspace_id: 'ws-1',
    ...overrides,
  }) as ProviderRow;

const asProfile = (overrides: Partial<AiProfileRow> = {}): AiProfileRow =>
  ({
    id: 'profile-1',
    name: 'Test Profile',
    provider_id: 'prov-1',
    external_ai_id: 'model-a',
    is_active: true,
    mode: 'chat',
    runtime_options: {},
    config: {},
    provider: asProvider(),
    workspace_id: 'ws-1',
    created_at: '2024-01-01',
    ...overrides,
  }) as AiProfileRow;

const asSession = (overrides: Partial<ChatSessionRow> = {}): ChatSessionRow =>
  ({
    id: 'session-1',
    ai_profile_id: 'profile-1',
    ai_profile: asProfile(),
    user_id: 'user-1',
    status: 'active',
    provider_type: 'google-gemini',
    external_chat_id: null,
    uses_user_credentials: false,
    processing_job_id: null,
    workflow_id: null,
    workflow_variables: {},
    calling_application: 'unit-test',
    message_count: 0,
    total_prompt_tokens: 0,
    total_completion_tokens: 0,
    system_prompt: null,
    provider_metadata: null,
    workspace_id: 'ws-1',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  }) as ChatSessionRow;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthContext).mockReturnValue(undefined);
  vi.mocked(effectiveUserId).mockReturnValue(null);
  vi.mocked(listChatMessages).mockResolvedValue([]);
  mockGetChatSession.mockReset();
});

describe('resumeChatSession', () => {
  it('throws when neither sessionId nor externalChatId is provided', async () => {
    await expect(resumeChatSession({})).rejects.toThrow(/sessionId or externalChatId/i);
  });

  it('throws not-found when the session row is missing (route → 404)', async () => {
    vi.mocked(getChatSession).mockResolvedValue(null);
    await expect(resumeChatSession({ sessionId: 'missing' })).rejects.toThrow('Chat session not found');
  });

  it('throws not-found for unknown externalChatId (route → 404)', async () => {
    vi.mocked(getChatSessionByExternalChatId).mockResolvedValue(null);
    await expect(resumeChatSession({ externalChatId: 'gone' })).rejects.toThrow('Chat session not found');
  });

  it('is idempotent for an already-active local session (no reactivate, no 409)', async () => {
    const session = asSession({ status: 'active', provider_type: 'google-gemini' });
    vi.mocked(getChatSession).mockResolvedValue(session);

    const result = await resumeChatSession({ sessionId: session.id });

    expect(reactivateChatSession).not.toHaveBeenCalled();
    expect(result.status).toBe('active');
    expect(result.sessionId).toBe(session.id);
    expect(result.messages).toEqual([]);
  });

  it('reactivates a closed local session under normal flow', async () => {
    const closed = asSession({ status: 'closed', provider_type: 'google-gemini' });
    const active = asSession({ status: 'active', provider_type: 'google-gemini' });
    vi.mocked(getChatSession).mockResolvedValueOnce(closed).mockResolvedValueOnce(active);
    vi.mocked(reactivateChatSession).mockResolvedValue(active);

    const result = await resumeChatSession({ sessionId: closed.id });

    expect(reactivateChatSession).toHaveBeenCalledWith(closed.id);
    expect(result.status).toBe('active');
  });

  it('restores local messages on resume (UI history, not a new chat)', async () => {
    const msgs = [
      { id: 'm1', role: 'user', content: 'hi' },
      { id: 'm2', role: 'assistant', content: 'hello' },
    ] as ChatMessageRow[];
    vi.mocked(getChatSession).mockResolvedValue(asSession({ status: 'active' }));
    vi.mocked(listChatMessages).mockResolvedValue(msgs);

    const result = await resumeChatSession({ sessionId: 'session-1' });
    expect(result.messages).toEqual(msgs);
  });

  it('throws "no longer available" when Devs.ai remote chat is gone (route → 409, not 404)', async () => {
    const session = asSession({
      status: 'closed',
      provider_type: 'devs-ai',
      external_chat_id: 'remote-chat-1',
    });
    vi.mocked(getChatSession).mockResolvedValue(session);
    vi.mocked(getAiProfileWithKeys).mockResolvedValue(asProfile());
    mockGetChatSession.mockRejectedValue(new Error('Chat session not found'));
    vi.mocked(createLlmClientForProvider).mockReturnValue({
      getChatSession: mockGetChatSession,
    } as unknown as ReturnType<typeof createLlmClientForProvider>);

    await expect(resumeChatSession({ sessionId: session.id })).rejects.toThrow(/no longer available/i);
    expect(reactivateChatSession).not.toHaveBeenCalled();
  });

  it('with fallbackToLocal, drops external_chat_id and resumes without 409', async () => {
    const session = asSession({
      status: 'closed',
      provider_type: 'devs-ai',
      external_chat_id: 'remote-chat-1',
    });
    const reactivated = asSession({
      status: 'active',
      provider_type: 'devs-ai',
      external_chat_id: null,
    });
    vi.mocked(getChatSession).mockResolvedValueOnce(session).mockResolvedValueOnce(reactivated);
    vi.mocked(getAiProfileWithKeys).mockResolvedValue(asProfile());
    mockGetChatSession.mockRejectedValue(new Error('Chat session not found'));
    vi.mocked(createLlmClientForProvider).mockReturnValue({
      getChatSession: mockGetChatSession,
    } as unknown as ReturnType<typeof createLlmClientForProvider>);
    vi.mocked(updateChatSession).mockResolvedValue({ ...session, external_chat_id: null });
    vi.mocked(reactivateChatSession).mockResolvedValue(reactivated);

    const result = await resumeChatSession({ sessionId: session.id, fallbackToLocal: true });

    expect(updateChatSession).toHaveBeenCalledWith(session.id, { external_chat_id: null });
    expect(reactivateChatSession).toHaveBeenCalledWith(session.id);
    expect(result.status).toBe('active');
  });

  it('requires user identity when session uses personal credentials', async () => {
    vi.mocked(getChatSession).mockResolvedValue(asSession({ uses_user_credentials: true, status: 'active' }));
    vi.mocked(effectiveUserId).mockReturnValue(null);

    await expect(resumeChatSession({ sessionId: 'session-1' })).rejects.toThrow(/personal credentials/i);
  });
});

describe('closeChatSession', () => {
  it('throws when the session is missing', async () => {
    vi.mocked(getChatSession).mockResolvedValue(null);
    await expect(closeChatSession('missing')).rejects.toThrow(/not found/i);
  });

  it('marks an active session closed', async () => {
    const session = asSession({ status: 'active' });
    const closed = asSession({ status: 'closed' });
    vi.mocked(getChatSession).mockResolvedValue(session);
    vi.mocked(updateChatSession).mockResolvedValue(closed);

    const result = await closeChatSession(session.id);

    expect(updateChatSession).toHaveBeenCalledWith(session.id, { status: 'closed' });
    expect(result.status).toBe('closed');
  });

  it('is idempotent — closing an already-closed session still succeeds', async () => {
    const closed = asSession({ status: 'closed' });
    vi.mocked(getChatSession).mockResolvedValue(closed);
    vi.mocked(updateChatSession).mockResolvedValue(closed);

    const result = await closeChatSession(closed.id);

    expect(updateChatSession).toHaveBeenCalledWith(closed.id, { status: 'closed' });
    expect(result.status).toBe('closed');
  });
});
