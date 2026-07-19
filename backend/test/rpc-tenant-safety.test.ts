import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestAuthContext } from '../src/types.ts';

const WORKSPACE_A = '11111111-1111-4000-a000-000000000001';

const apiKeyCtx = (workspaceId: string): RequestAuthContext => ({
  mode: 'api_key' as const,
  workspaceId,
  apiKeyId: 'test-key-id',
  apiKeyRole: 'admin',
});

const mockRpc = vi.fn().mockResolvedValue({ data: {}, error: null });

const mockSelectChain = {
  eq: vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: 'sess-1',
        workspace_id: WORKSPACE_A,
        message_count: 0,
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        ai_profile: null,
      },
      error: null,
    }),
    order: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  }),
};

const mockFrom = vi.fn().mockReturnValue({
  select: vi.fn().mockReturnValue(mockSelectChain),
  insert: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: {}, error: null }),
    }),
  }),
  update: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: {}, error: null }),
      }),
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  }),
  delete: vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  }),
});

vi.mock('../src/db/service-supabase.ts', () => ({
  getServiceSupabase: () => ({
    rpc: mockRpc,
    from: mockFrom,
  }),
}));

vi.mock('../src/config.ts', () => ({
  getConfig: () => ({
    aiManagerSupabase: { url: 'https://test.supabase.co', anonKey: 'test-anon-key' },
  }),
}));

import { runWithAuth } from '../src/db/tenant.ts';

describe('RPC tenant safety — merge_workflow_variables', () => {
  beforeEach(() => {
    mockRpc.mockClear();
  });

  it('chat-sessions model passes p_workspace_id', async () => {
    const { mergeWorkflowVariables } = await import('../src/models/chat-sessions.ts');

    await runWithAuth(apiKeyCtx(WORKSPACE_A), async () => {
      await mergeWorkflowVariables('sess-1', { step1_output: 'value' });
    });

    expect(mockRpc).toHaveBeenCalledWith('merge_workflow_variables', {
      p_session_id: 'sess-1',
      p_new_vars: { step1_output: 'value' },
      p_workspace_id: WORKSPACE_A,
    });
  });
});

describe('RPC tenant safety — hc_daily_run_summary', () => {
  beforeEach(() => {
    mockRpc.mockClear();
  });

  it('getDailyRunSummary passes p_workspace_id', async () => {
    const { getDailyRunSummary } = await import('../src/models/health-checks.ts');

    await runWithAuth(apiKeyCtx(WORKSPACE_A), async () => {
      await getDailyRunSummary('check-1', '2026-01-01', '2026-01-31');
    });

    expect(mockRpc).toHaveBeenCalledWith('hc_daily_run_summary', {
      p_check_id: 'check-1',
      p_start: '2026-01-01',
      p_end: '2026-01-31',
      p_workspace_id: WORKSPACE_A,
    });
  });
});

describe('calling_applications onConflict', () => {
  it('upsert uses workspace_id,id composite conflict target', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync('src/models/calling-applications.ts', 'utf8');
    expect(source).toContain("onConflict: 'workspace_id,id'");
    expect(source).not.toMatch(/onConflict:\s*'id'/);
  });
});
