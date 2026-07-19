/**
 * Direct unit tests for `ai-manager/index.ts` (BE-01 test-first step).
 * ----------------------------------------------------------------
 * These are characterization tests written against the CURRENT, unsplit
 * `ai-manager/index.ts` before any extraction. They mock every external
 * dependency (models/*, integrations/*, services/*) so the four highest-risk
 * exported functions — executeJobById, openChatSession, sendChatMessage,
 * uploadApiDataSourcesChunked — are exercised in isolation, not just
 * transitively via HTTP route tests.
 *
 * They MUST keep passing, unmodified, through every step of the BE-01
 * ai-manager/ directory split (only the import path's underlying file
 * layout changes; the barrel keeps `../src/ai-manager/index.ts` resolving
 * to the same public surface throughout).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiProfileRow, ChatSessionRow, ProcessingJobRow, ProviderRow } from '../src/types.ts';

/* ── Mocks: models ──────────────────────────────────────────── */

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
  getWorkflowStepByKey: vi.fn(),
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

vi.mock('../src/models/app-settings.ts', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));

/* ── Mocks: integrations ────────────────────────────────────── */

vi.mock('../src/integrations/client-factory.ts', () => ({
  createLlmClientForProvider: vi.fn(),
  createLlmClientForUser: vi.fn(),
}));

const mockCreateApiDataSource = vi.fn();
const mockRefreshDataSource = vi.fn();

vi.mock('../src/integrations/devs-ai/client.ts', () => ({
  DevsAiClient: vi.fn().mockImplementation(function DevsAiClientMock() {
    return {
      createApiDataSource: mockCreateApiDataSource,
      refreshDataSource: mockRefreshDataSource,
    };
  }),
}));

/* ── Mocks: services ────────────────────────────────────────── */

vi.mock('../src/services/formatting-rules.ts', () => ({
  applyFormattingRules: vi.fn((raw: string) => ({ formatted: raw, steps: [] })),
}));

vi.mock('../src/services/ai-diagnostics.ts', () => {
  class FakeDiagnosticSession {
    complete = vi.fn().mockResolvedValue(null);
    logRequestPayload = vi.fn();
    startSupabaseTimer = vi.fn();
    endSupabaseTimer = vi.fn();
    startLlmTimer = vi.fn();
    endLlmTimer = vi.fn();
    startFormattingTimer = vi.fn();
    endFormattingTimer = vi.fn();
    addMetadata = vi.fn();
  }
  return {
    DiagnosticSession: FakeDiagnosticSession,
    shouldRunDiagnostics: vi.fn(() => ({ enabled: false, persist: false })),
  };
});

vi.mock('../src/services/attachment-resolver.ts', () => ({
  resolveAttachments: vi.fn().mockResolvedValue([]),
  resolveAttachmentsAsText: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/services/session-compaction.ts', () => ({
  maybeCompactSession: vi.fn().mockResolvedValue({ summary: null, estimatedTokens: 0, compacted: false }),
  buildCompactedHistory: vi.fn((_session: unknown, messages: unknown) => messages),
  getSummarizerConfig: vi.fn(() => null),
}));

/* ── Mocks: db ───────────────────────────────────────────────── */

vi.mock('../src/db/tenant.ts', () => ({
  getAuthContext: vi.fn(() => undefined),
  effectiveUserId: vi.fn(() => null),
  requireWorkspaceId: vi.fn(() => 'ws-1'),
  tenantFrom: vi.fn(),
}));

vi.mock('../src/db/service-supabase.ts', () => ({
  getServiceSupabase: vi.fn(),
}));

/* ── Imports (after mocks) ──────────────────────────────────── */

import {
  executeJobById,
  openChatSession,
  sendChatMessage,
  uploadApiDataSourcesChunked,
} from '../src/ai-manager/index.ts';
import { getProcessingJobBySlug, getProcessingJob, updateProcessingJob } from '../src/models/processing-jobs.ts';
import { getAiProfileWithKeys } from '../src/models/ai-profiles.ts';
import { createLlmClientForProvider } from '../src/integrations/client-factory.ts';
import { createChatSession, getChatSession, createChatMessage } from '../src/models/chat-sessions.ts';
import { applyFormattingRules } from '../src/services/formatting-rules.ts';

const asProviderRow = (overrides: Partial<ProviderRow> = {}): ProviderRow =>
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

const asAiProfileRow = (overrides: Partial<AiProfileRow> = {}): AiProfileRow =>
  ({
    id: 'profile-1',
    name: 'Test Profile',
    provider_id: 'prov-1',
    external_ai_id: 'model-a',
    is_active: true,
    mode: 'completion',
    runtime_options: {},
    config: {},
    provider: asProviderRow(),
    workspace_id: 'ws-1',
    created_at: '2024-01-01',
    ...overrides,
  }) as AiProfileRow;

const asProcessingJobRow = (overrides: Partial<ProcessingJobRow> = {}): ProcessingJobRow =>
  ({
    id: 'job-1',
    name: 'Test Job',
    slug: 'test-job',
    is_active: true,
    config: { promptTemplate: 'Hello {{name}}' },
    ai_profile_id: 'profile-1',
    ai_profile: asAiProfileRow(),
    calling_application_id: 'ai-admin-test',
    workspace_id: 'ws-1',
    created_at: '2024-01-01',
    ...overrides,
  }) as ProcessingJobRow;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(applyFormattingRules).mockImplementation((raw: string) => ({ formatted: raw, steps: [] }));
});

/* ================================================================
   executeJobById
   ================================================================ */
describe('executeJobById', () => {
  it('resolves job -> profile -> provider, calls the LLM, and applies formatting', async () => {
    const job = asProcessingJobRow();
    vi.mocked(getProcessingJob).mockResolvedValue(job);
    const mockClient = {
      chatCompletion: vi.fn().mockResolvedValue({
        model: 'model-a',
        choices: [{ message: { content: 'raw response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      }),
    };
    vi.mocked(createLlmClientForProvider).mockReturnValue(
      mockClient as unknown as ReturnType<typeof createLlmClientForProvider>,
    );

    const result = await executeJobById('job-1', { callingApplication: 'unit-test', variables: { name: 'World' } });

    expect(result.raw).toBe('raw response');
    expect(result.formatted).toBe('raw response');
    expect(result.metadata.model).toBe('model-a');
    expect(result.metadata.jobSlug).toBe('test-job');
    expect(mockClient.chatCompletion).toHaveBeenCalledTimes(1);
    const [modelArg, messagesArg] = mockClient.chatCompletion.mock.calls[0] as [string, Array<{ content: unknown }>];
    expect(modelArg).toBe('model-a');
    expect(messagesArg[0]?.content).toBe('Hello <user_input name="name">World</user_input>');
  });

  it('falls back to the failover provider when the primary model errors', async () => {
    const job = asProcessingJobRow({
      ai_profile: asAiProfileRow({
        failover_provider: asProviderRow({ id: 'prov-2', name: 'Failover Provider', api_key: 'failover-key' }),
        failover_external_ai_id: 'model-b',
      }),
    });
    vi.mocked(getProcessingJob).mockResolvedValue(job);

    const primaryClient = { chatCompletion: vi.fn().mockRejectedValue(new Error('primary down')) };
    const failoverClient = {
      chatCompletion: vi.fn().mockResolvedValue({
        model: 'model-b',
        choices: [{ message: { content: 'failover response' }, finish_reason: 'stop' }],
        usage: null,
      }),
    };
    vi.mocked(createLlmClientForProvider).mockImplementation(
      (provider: ProviderRow) =>
        (provider.id === 'prov-2' ? failoverClient : primaryClient) as unknown as ReturnType<
          typeof createLlmClientForProvider
        >,
    );

    const result = await executeJobById('job-1', {});

    expect(result.raw).toBe('failover response');
    expect(result.metadata.model).toBe('model-b');
    expect(primaryClient.chatCompletion).toHaveBeenCalledTimes(1);
    expect(failoverClient.chatCompletion).toHaveBeenCalledTimes(1);
  });

  it('throws a combined error when both primary and failover fail', async () => {
    const job = asProcessingJobRow({
      ai_profile: asAiProfileRow({
        failover_provider: asProviderRow({ id: 'prov-2', name: 'Failover Provider' }),
        failover_external_ai_id: 'model-b',
      }),
    });
    vi.mocked(getProcessingJob).mockResolvedValue(job);
    const failingClient = { chatCompletion: vi.fn().mockRejectedValue(new Error('boom')) };
    vi.mocked(createLlmClientForProvider).mockReturnValue(
      failingClient as unknown as ReturnType<typeof createLlmClientForProvider>,
    );

    await expect(executeJobById('job-1', {})).rejects.toThrow(/also failed/);
  });

  it('throws when the job has no AI profile or provider assigned', async () => {
    const job = asProcessingJobRow({ ai_profile: null });
    vi.mocked(getProcessingJob).mockResolvedValue(job);

    await expect(executeJobById('job-1', {})).rejects.toThrow('Processing job has no AI profile or provider assigned');
  });

  it('throws when the job id does not resolve', async () => {
    vi.mocked(getProcessingJob).mockRejectedValue(new Error('not found'));

    await expect(executeJobById('missing-job', {})).rejects.toThrow('not found');
  });

  it('auto-registers a new calling application and tags the job', async () => {
    const job = asProcessingJobRow({ calling_application_id: null });
    vi.mocked(getProcessingJob).mockResolvedValue(job);
    vi.mocked(updateProcessingJob).mockResolvedValue(job);
    const mockClient = {
      chatCompletion: vi.fn().mockResolvedValue({
        model: 'model-a',
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: null,
      }),
    };
    vi.mocked(createLlmClientForProvider).mockReturnValue(
      mockClient as unknown as ReturnType<typeof createLlmClientForProvider>,
    );

    await executeJobById('job-1', { callingApplication: 'my-app' });

    expect(updateProcessingJob).toHaveBeenCalledWith('job-1', { calling_application_id: 'my-app' });
  });
});

/* ================================================================
   openChatSession
   ================================================================ */
describe('openChatSession', () => {
  it('resolves a job slug into a chat session and returns its shape', async () => {
    const job = asProcessingJobRow({ config: { systemPrompt: 'be nice', ruleSets: [{ key: 'r1', name: 'Rule 1' }] } });
    vi.mocked(getProcessingJobBySlug).mockResolvedValue(job);
    vi.mocked(createChatSession).mockResolvedValue({
      id: 'session-1',
      ai_profile_id: 'profile-1',
      user_id: 'user-1',
      external_chat_id: null,
      provider_type: 'devs-ai',
      status: 'active',
      workspace_id: 'ws-1',
      created_at: '2024-01-01',
    } as ChatSessionRow);

    const result = await openChatSession('test-job', { userId: 'user-1', callingApplication: 'unit-test' });

    expect(result.sessionId).toBe('session-1');
    expect(result.status).toBe('active');
    expect(result.aiProfileId).toBe('profile-1');
    expect(result.ruleSets).toEqual([{ key: 'r1', name: 'Rule 1', description: null }]);
    expect(createChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ chat_session_id: 'session-1', role: 'system', content: 'be nice' }),
    );
  });

  it('throws when userId is missing', async () => {
    await expect(openChatSession('test-job', { userId: '' })).rejects.toThrow('userId is required for chat sessions');
  });

  it('throws when no AI profile with a provider can be resolved', async () => {
    vi.mocked(getProcessingJobBySlug).mockResolvedValue(null);
    vi.mocked(getProcessingJob).mockRejectedValue(new Error('not a uuid'));
    vi.mocked(getAiProfileWithKeys).mockResolvedValue(null as unknown as AiProfileRow);

    await expect(openChatSession('unknown-profile', { userId: 'user-1' })).rejects.toThrow(
      'Could not resolve AI profile with provider',
    );
  });

  it('requires a stored personal credential when the job requires user credentials', async () => {
    const job = asProcessingJobRow({ requires_user_credentials: true });
    vi.mocked(getProcessingJobBySlug).mockResolvedValue(job);
    const { getAuthContext, effectiveUserId } = await import('../src/db/tenant.ts');
    vi.mocked(getAuthContext).mockReturnValue({ mode: 'jwt', userId: 'user-1' } as never);
    vi.mocked(effectiveUserId).mockReturnValue('user-1');
    const { getUserCredential } = await import('../src/models/user-provider-credentials.ts');
    vi.mocked(getUserCredential).mockResolvedValue(null);

    await expect(openChatSession('test-job', { userId: 'user-1' })).rejects.toThrow(
      'This job requires personal credentials',
    );
  });
});

/* ================================================================
   sendChatMessage
   ================================================================ */
describe('sendChatMessage', () => {
  const baseSession = (): ChatSessionRow =>
    ({
      id: 'session-1',
      ai_profile_id: 'profile-1',
      user_id: 'user-1',
      external_chat_id: null,
      provider_type: 'devs-ai-v2',
      status: 'active',
      message_count: 1,
      workflow_variables: {},
      ai_profile: asAiProfileRow({ provider: asProviderRow({ type: 'devs-ai-v2' }) }),
      workspace_id: 'ws-1',
      created_at: '2024-01-01',
    }) as ChatSessionRow;

  it('streams a free-form message through chatCompletionStream and returns metadata', async () => {
    vi.mocked(getChatSession).mockResolvedValue(baseSession());
    vi.mocked(getAiProfileWithKeys).mockResolvedValue(
      asAiProfileRow({ provider: asProviderRow({ type: 'devs-ai-v2' }) }),
    );
    const fakeResponse = new Response('ok');
    const mockClient = { chatCompletionStream: vi.fn().mockResolvedValue(fakeResponse) };
    vi.mocked(createLlmClientForProvider).mockReturnValue(
      mockClient as unknown as ReturnType<typeof createLlmClientForProvider>,
    );

    const result = await sendChatMessage('session-1', 'Hello there');

    expect(result.response).toBe(fakeResponse);
    expect(result.sessionId).toBe('session-1');
    expect(result.resolvedMessage).toBe('Hello there');
    expect(result.userMessageId).toBe('msg-1');
    expect(mockClient.chatCompletionStream).toHaveBeenCalledTimes(1);
    expect(createChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ chat_session_id: 'session-1', role: 'user', content: 'Hello there' }),
    );
  });

  it('throws when the chat session does not exist', async () => {
    vi.mocked(getChatSession).mockResolvedValue(null);

    await expect(sendChatMessage('missing-session', 'hi')).rejects.toThrow('Chat session missing-session not found');
  });

  it('throws when the chat session is not active', async () => {
    vi.mocked(getChatSession).mockResolvedValue({ ...baseSession(), status: 'closed' });

    await expect(sendChatMessage('session-1', 'hi')).rejects.toThrow('Chat session session-1 is closed');
  });

  it('throws when no message, stepKey, or ruleSetKey resolves any content', async () => {
    vi.mocked(getChatSession).mockResolvedValue(baseSession());
    vi.mocked(getAiProfileWithKeys).mockResolvedValue(
      asAiProfileRow({ provider: asProviderRow({ type: 'devs-ai-v2' }) }),
    );

    await expect(sendChatMessage('session-1', null)).rejects.toThrow(
      'No message content resolved — provide a message, stepKey, or ruleSetKey',
    );
  });

  it('resolves a rule set template with the provided variables', async () => {
    const session = {
      ...baseSession(),
      processing_job_id: 'job-1',
    } as ChatSessionRow;
    vi.mocked(getChatSession).mockResolvedValue(session);
    vi.mocked(getAiProfileWithKeys).mockResolvedValue(
      asAiProfileRow({ provider: asProviderRow({ type: 'devs-ai-v2' }) }),
    );
    vi.mocked(getProcessingJob).mockResolvedValue(
      asProcessingJobRow({
        config: {
          ruleSets: [{ key: 'summarize', name: 'Summarize', promptTemplate: 'Summarize: {{topic}}' }],
        },
      }),
    );
    const fakeResponse = new Response('ok');
    const mockClient = { chatCompletionStream: vi.fn().mockResolvedValue(fakeResponse) };
    vi.mocked(createLlmClientForProvider).mockReturnValue(
      mockClient as unknown as ReturnType<typeof createLlmClientForProvider>,
    );

    const result = await sendChatMessage('session-1', null, { ruleSetKey: 'summarize', variables: { topic: 'cats' } });

    expect(result.ruleSetKey).toBe('summarize');
    expect(result.resolvedMessage).toBe('Summarize: <user_input name="topic">cats</user_input>');
  });
});

/* ================================================================
   uploadApiDataSourcesChunked
   ================================================================ */
describe('uploadApiDataSourcesChunked', () => {
  const jobWithDevsAiProfile = (): ProcessingJobRow =>
    asProcessingJobRow({
      ai_profile: asAiProfileRow({
        external_ai_id: 'ai-123',
        provider: asProviderRow({ type: 'devs-ai', api_key: 'devs-key' }),
      }),
    });

  it('throws when neither jobSlug nor jobId is provided', async () => {
    await expect(uploadApiDataSourcesChunked({})).rejects.toThrow('requires jobSlug or jobId');
  });

  it('throws when the provider is not devs-ai', async () => {
    const job = asProcessingJobRow({
      ai_profile: asAiProfileRow({ provider: asProviderRow({ type: 'google-gemini' }) }),
    });
    vi.mocked(getProcessingJobBySlug).mockResolvedValue(job);

    await expect(uploadApiDataSourcesChunked({ jobSlug: 'test-job', rows: [{ a: 1 }] })).rejects.toThrow(
      'only supported for Devs.ai provider',
    );
  });

  it('uploads all rows in a single chunk when under the byte cap', async () => {
    vi.mocked(getProcessingJobBySlug).mockResolvedValue(jobWithDevsAiProfile());
    mockCreateApiDataSource.mockResolvedValue({ dataSourceId: 'ds-1' });
    mockRefreshDataSource.mockResolvedValue({});

    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i, value: `row-${i}` }));
    const summary = await uploadApiDataSourcesChunked({ jobSlug: 'test-job', rows });

    expect(summary.status).toBe('success');
    expect(summary.totalChunks).toBe(1);
    expect((summary.uploadedDataSources as unknown[]).length).toBe(1);
    expect(mockCreateApiDataSource).toHaveBeenCalledTimes(1);
    const [, , payload] = mockCreateApiDataSource.mock.calls[0] as [string, string, { mappings: unknown[] }];
    expect(payload.mappings).toHaveLength(5);
  });

  it('splits rows across multiple chunks without losing or duplicating any row', async () => {
    vi.mocked(getProcessingJobBySlug).mockResolvedValue(jobWithDevsAiProfile());
    mockCreateApiDataSource.mockImplementation(
      (_aiId: string, _name: string, data: { mappings: Array<{ id: number }> }) =>
        Promise.resolve({ dataSourceId: `ds-${data.mappings[0]?.id}` }),
    );
    mockRefreshDataSource.mockResolvedValue({});

    /* Each row serializes to well over 100 bytes — force many small chunks. */
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: i, value: `row-value-padding-${i}-${'x'.repeat(50)}` }));
    const summary = await uploadApiDataSourcesChunked({ jobSlug: 'test-job', rows, maxChunkBytes: 300 });

    expect(summary.totalChunks).toBeGreaterThan(1);
    expect(summary.status).toBe('success');
    const uploaded = summary.uploadedDataSources as Array<{ rows: number }>;
    const totalRowsAcrossChunks = uploaded.reduce((sum, c) => sum + c.rows, 0);
    expect(totalRowsAcrossChunks).toBe(40);
    /* Every chunk must actually respect the byte cap (correctness, not just count). */
    for (const call of mockCreateApiDataSource.mock.calls as Array<[string, string, { mappings: unknown[] }]>) {
      const bytes = Buffer.byteLength(JSON.stringify({ mappings: call[2].mappings }), 'utf8');
      expect(bytes).toBeLessThanOrEqual(
        300 + Buffer.byteLength(JSON.stringify({ mappings: [call[2].mappings[0]] }), 'utf8'),
      );
    }
  });

  it('records failed chunks and throws a partial-failure error while preserving the summary', async () => {
    vi.mocked(getProcessingJobBySlug).mockResolvedValue(jobWithDevsAiProfile());
    mockCreateApiDataSource.mockRejectedValue(new Error('devs.ai upload failed'));

    const rows = [{ id: 1 }, { id: 2 }];
    let caught: (Error & { summary?: Record<string, unknown> }) | null = null;
    try {
      await uploadApiDataSourcesChunked({ jobSlug: 'test-job', rows });
    } catch (err) {
      caught = err as Error & { summary?: Record<string, unknown> };
    }

    expect(caught).not.toBeNull();
    expect(caught?.message).toContain('partial failure');
    expect(caught?.summary).toBeDefined();
    const failedChunks = caught?.summary?.failedChunks as unknown[];
    expect(failedChunks.length).toBe(1);
  });
});
