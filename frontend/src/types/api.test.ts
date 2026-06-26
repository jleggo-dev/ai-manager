import type {
  Provider,
  AiProfile,
  ProcessingJob,
  ChatSession,
  ChatMessage,
  Workspace,
  WorkspaceMember,
  WorkspaceMembership,
  ApiKey,
  CreateApiKeyResponse,
  AppSetting,
  CallingApplication,
  Workflow,
  WorkflowStep,
  DiagnosticLog,
  ProcessingJobGroup,
  LlmModel,
  SyncModelsResult,
  HealthCheckResult,
  UserCredential,
  PaginatedResponse,
} from './api';

describe('api type imports', () => {
  it('all major types are importable without errors', () => {
    const typeChecks: Record<string, unknown> = {
      Provider: undefined as unknown as Provider,
      AiProfile: undefined as unknown as AiProfile,
      ProcessingJob: undefined as unknown as ProcessingJob,
      ChatSession: undefined as unknown as ChatSession,
      ChatMessage: undefined as unknown as ChatMessage,
      Workspace: undefined as unknown as Workspace,
      WorkspaceMember: undefined as unknown as WorkspaceMember,
      WorkspaceMembership: undefined as unknown as WorkspaceMembership,
      ApiKey: undefined as unknown as ApiKey,
      CreateApiKeyResponse: undefined as unknown as CreateApiKeyResponse,
      AppSetting: undefined as unknown as AppSetting,
      CallingApplication: undefined as unknown as CallingApplication,
      Workflow: undefined as unknown as Workflow,
      WorkflowStep: undefined as unknown as WorkflowStep,
      DiagnosticLog: undefined as unknown as DiagnosticLog,
      ProcessingJobGroup: undefined as unknown as ProcessingJobGroup,
      LlmModel: undefined as unknown as LlmModel,
      SyncModelsResult: undefined as unknown as SyncModelsResult,
      HealthCheckResult: undefined as unknown as HealthCheckResult,
      UserCredential: undefined as unknown as UserCredential,
    };
    expect(Object.keys(typeChecks)).toHaveLength(20);
  });
});

describe('PaginatedResponse shape', () => {
  it('matches expected structure via runtime type guard', () => {
    function isPaginatedResponse<T>(val: unknown): val is PaginatedResponse<T> {
      if (!val || typeof val !== 'object') return false;
      const obj = val as Record<string, unknown>;
      if (!Array.isArray(obj.data)) return false;
      if (!obj.pagination || typeof obj.pagination !== 'object') return false;
      const pag = obj.pagination as Record<string, unknown>;
      return (
        'next_cursor' in pag &&
        'prev_cursor' in pag &&
        typeof pag.has_more === 'boolean' &&
        typeof pag.limit === 'number'
      );
    }

    const valid: PaginatedResponse<string> = {
      data: ['a', 'b'],
      pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 25 },
    };
    expect(isPaginatedResponse(valid)).toBe(true);
    expect(isPaginatedResponse({ data: [] })).toBe(false);
  });
});

describe('key interface fields (compile-time validation)', () => {
  it('Provider has required fields', () => {
    const provider: Provider = {
      id: '1',
      name: 'test',
      type: 'openai',
      base_url: 'https://api.openai.com',
      is_active: true,
      request_timeout_ms: null,
      workspace_id: 'ws-1',
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    expect(provider.id).toBeDefined();
    expect(provider.name).toBeDefined();
    expect(provider.api_key).toBeUndefined();
  });
});
