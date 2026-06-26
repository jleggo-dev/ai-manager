import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/integrations/client-factory.ts', () => ({
  createLlmClientForProvider: vi.fn(),
}));

vi.mock('../src/lib/crypto.ts', () => ({
  decryptSecret: vi.fn((val: string) => val),
  encryptSecret: vi.fn((val: string) => val),
}));

vi.mock('../src/models/health-checks.ts', () => ({
  serviceInsertRun: vi.fn(),
  serviceUpdateCheckLastRun: vi.fn(),
  serviceGetOpenIncident: vi.fn(),
  serviceOpenIncident: vi.fn(),
  serviceUpdateIncident: vi.fn(),
  serviceResolveIncident: vi.fn(),
}));

import { executeHealthCheck, runAndRecordCheck } from '../src/services/health-checker.ts';
import { createLlmClientForProvider } from '../src/integrations/client-factory.ts';
import * as hcModels from '../src/models/health-checks.ts';
import type {
  HealthCheckRow,
  HealthCheckRunRow,
  HealthCheckIncidentRow,
  HealthCheckProfileRow,
  HealthCheckProviderKeyRow,
  ProviderRow,
} from '../src/types.ts';

const mockProvider = {
  id: 'prov-1',
  name: 'Test Provider',
  type: 'devs-ai',
  base_url: 'https://test.ai',
  api_key: 'original-key',
  is_active: true,
  workspace_id: 'ws-1',
  created_at: '2024-01-01',
};

const mockProviderKey = {
  id: 'key-1',
  workspace_id: 'ws-1',
  provider_id: 'prov-1',
  name: 'HC Key',
  api_key: 'hc-dedicated-key',
  is_active: true,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
};

const mockProfile = {
  id: 'prof-1',
  workspace_id: 'ws-1',
  provider_id: 'prov-1',
  hc_provider_key_id: 'key-1',
  external_ai_id: 'test-model',
  name: 'HC Profile',
  mode: 'completion',
  profile_type: 'model',
  runtime_options: {},
  is_active: true,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
  provider: mockProvider,
  hc_provider_key: mockProviderKey,
};

const mockCheck = {
  id: 'chk-1',
  workspace_id: 'ws-1',
  health_check_profile_id: 'prof-1',
  name: 'Test Check',
  test_message: 'Hello, are you there?',
  cadence_minutes: 15,
  outage_cadence_minutes: 2,
  is_active: true,
  last_run_at: null,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
  health_check_profile: mockProfile,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeHealthCheck', () => {
  it('returns pass when LLM responds successfully', async () => {
    const mockClient = {
      chatCompletion: vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'I am operational' }, finish_reason: 'stop' }],
        usage: null,
      }),
    };
    vi.mocked(createLlmClientForProvider).mockReturnValue(
      mockClient as unknown as ReturnType<typeof createLlmClientForProvider>,
    );

    const result = await executeHealthCheck(
      mockCheck as unknown as HealthCheckRow,
      mockProfile as unknown as HealthCheckProfileRow,
      mockProviderKey as unknown as HealthCheckProviderKeyRow,
    );

    expect(result.status).toBe('pass');
    expect(result.rawResponse).toContain('operational');
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.errorMessage).toBeNull();
  });

  it('returns fail when LLM throws an error', async () => {
    const mockClient = {
      chatCompletion: vi.fn().mockRejectedValue(new Error('API error')),
    };
    vi.mocked(createLlmClientForProvider).mockReturnValue(
      mockClient as unknown as ReturnType<typeof createLlmClientForProvider>,
    );

    const result = await executeHealthCheck(
      mockCheck as unknown as HealthCheckRow,
      mockProfile as unknown as HealthCheckProfileRow,
      mockProviderKey as unknown as HealthCheckProviderKeyRow,
    );

    expect(result.status).toBe('fail');
    expect(result.errorMessage).toBe('API error');
  });

  it('returns timeout when LLM exceeds timeout', async () => {
    const mockClient = {
      chatCompletion: vi.fn().mockRejectedValue(new Error('Health check timed out')),
    };
    vi.mocked(createLlmClientForProvider).mockReturnValue(
      mockClient as unknown as ReturnType<typeof createLlmClientForProvider>,
    );

    const result = await executeHealthCheck(
      mockCheck as unknown as HealthCheckRow,
      mockProfile as unknown as HealthCheckProfileRow,
      mockProviderKey as unknown as HealthCheckProviderKeyRow,
    );

    expect(result.status).toBe('timeout');
    expect(result.errorMessage).toContain('timed out');
  });

  it('returns error when provider is missing from profile', async () => {
    const profileWithoutProvider = { ...mockProfile, provider: undefined };

    const result = await executeHealthCheck(
      mockCheck as unknown as HealthCheckRow,
      profileWithoutProvider as unknown as HealthCheckProfileRow,
      mockProviderKey as unknown as HealthCheckProviderKeyRow,
    );

    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('Provider not found');
  });

  it('uses the HC provider key, not the original provider key', async () => {
    const mockClient = {
      chatCompletion: vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: null,
      }),
    };
    vi.mocked(createLlmClientForProvider).mockReturnValue(
      mockClient as unknown as ReturnType<typeof createLlmClientForProvider>,
    );

    await executeHealthCheck(
      mockCheck as unknown as HealthCheckRow,
      mockProfile as unknown as HealthCheckProfileRow,
      mockProviderKey as unknown as HealthCheckProviderKeyRow,
    );

    expect(createLlmClientForProvider).toHaveBeenCalledWith(expect.objectContaining({ api_key: 'hc-dedicated-key' }));
    const calledWith = vi.mocked(createLlmClientForProvider).mock.calls[0]?.[0] as unknown as ProviderRow;
    expect(calledWith.api_key).not.toBe('original-key');
  });
});

describe('runAndRecordCheck - incident state machine', () => {
  it('opens a new incident when check fails and no existing incident', async () => {
    const mockClient = {
      chatCompletion: vi.fn().mockRejectedValue(new Error('Connection refused')),
    };
    vi.mocked(createLlmClientForProvider).mockReturnValue(
      mockClient as unknown as ReturnType<typeof createLlmClientForProvider>,
    );
    vi.mocked(hcModels.serviceGetOpenIncident).mockResolvedValue(null);
    vi.mocked(hcModels.serviceInsertRun).mockResolvedValue({
      id: 'run-1',
      health_check_id: 'chk-1',
      workspace_id: 'ws-1',
      status: 'fail',
      response_time_ms: 100,
      error_message: 'Connection refused',
      raw_response: null,
      created_at: '2024-01-01',
    } as unknown as HealthCheckRunRow);
    vi.mocked(hcModels.serviceUpdateCheckLastRun).mockResolvedValue(undefined);

    await runAndRecordCheck(mockCheck as unknown as HealthCheckRow & { health_check_profile: HealthCheckProfileRow });

    expect(hcModels.serviceOpenIncident).toHaveBeenCalledWith('chk-1', 'ws-1', 'Connection refused');
  });

  it('updates existing incident on consecutive failure', async () => {
    const mockClient = {
      chatCompletion: vi.fn().mockRejectedValue(new Error('Still broken')),
    };
    vi.mocked(createLlmClientForProvider).mockReturnValue(
      mockClient as unknown as ReturnType<typeof createLlmClientForProvider>,
    );
    vi.mocked(hcModels.serviceGetOpenIncident).mockResolvedValue({
      id: 'inc-1',
      health_check_id: 'chk-1',
      workspace_id: 'ws-1',
      failed_run_count: 3,
      started_at: '2024-01-01T00:00:00Z',
      resolved_at: null,
      duration_seconds: null,
      last_error: 'old error',
    } as unknown as HealthCheckIncidentRow);
    vi.mocked(hcModels.serviceInsertRun).mockResolvedValue({
      id: 'run-2',
      health_check_id: 'chk-1',
      workspace_id: 'ws-1',
      status: 'fail',
      response_time_ms: 200,
      error_message: 'Still broken',
      raw_response: null,
      created_at: '2024-01-01',
    } as unknown as HealthCheckRunRow);
    vi.mocked(hcModels.serviceUpdateCheckLastRun).mockResolvedValue(undefined);

    await runAndRecordCheck(mockCheck as unknown as HealthCheckRow & { health_check_profile: HealthCheckProfileRow });

    expect(hcModels.serviceUpdateIncident).toHaveBeenCalledWith('inc-1', {
      failed_run_count: 4,
      last_error: 'Still broken',
    });
  });

  it('resolves incident when check passes after failure', async () => {
    const mockClient = {
      chatCompletion: vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'Back online' }, finish_reason: 'stop' }],
        usage: null,
      }),
    };
    vi.mocked(createLlmClientForProvider).mockReturnValue(
      mockClient as unknown as ReturnType<typeof createLlmClientForProvider>,
    );
    vi.mocked(hcModels.serviceGetOpenIncident).mockResolvedValue({
      id: 'inc-1',
      health_check_id: 'chk-1',
      workspace_id: 'ws-1',
      failed_run_count: 5,
      started_at: '2024-01-01T00:00:00Z',
      resolved_at: null,
      duration_seconds: null,
      last_error: 'was broken',
    } as unknown as HealthCheckIncidentRow);
    vi.mocked(hcModels.serviceInsertRun).mockResolvedValue({
      id: 'run-3',
      health_check_id: 'chk-1',
      workspace_id: 'ws-1',
      status: 'pass',
      response_time_ms: 50,
      error_message: null,
      raw_response: 'Back online',
      created_at: '2024-01-01',
    } as unknown as HealthCheckRunRow);
    vi.mocked(hcModels.serviceUpdateCheckLastRun).mockResolvedValue(undefined);

    await runAndRecordCheck(mockCheck as unknown as HealthCheckRow & { health_check_profile: HealthCheckProfileRow });

    expect(hcModels.serviceResolveIncident).toHaveBeenCalledWith('inc-1', '2024-01-01T00:00:00Z');
  });

  it('does nothing special when check passes and no incident open', async () => {
    const mockClient = {
      chatCompletion: vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'All good' }, finish_reason: 'stop' }],
        usage: null,
      }),
    };
    vi.mocked(createLlmClientForProvider).mockReturnValue(
      mockClient as unknown as ReturnType<typeof createLlmClientForProvider>,
    );
    vi.mocked(hcModels.serviceGetOpenIncident).mockResolvedValue(null);
    vi.mocked(hcModels.serviceInsertRun).mockResolvedValue({
      id: 'run-4',
      health_check_id: 'chk-1',
      workspace_id: 'ws-1',
      status: 'pass',
      response_time_ms: 30,
      error_message: null,
      raw_response: 'All good',
      created_at: '2024-01-01',
    } as unknown as HealthCheckRunRow);
    vi.mocked(hcModels.serviceUpdateCheckLastRun).mockResolvedValue(undefined);

    await runAndRecordCheck(mockCheck as unknown as HealthCheckRow & { health_check_profile: HealthCheckProfileRow });

    expect(hcModels.serviceOpenIncident).not.toHaveBeenCalled();
    expect(hcModels.serviceResolveIncident).not.toHaveBeenCalled();
  });
});
