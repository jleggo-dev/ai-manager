/**
 * FE-10 contract: frontend response types must match backend/DB column sets.
 * Keep these lists in sync with `backend/test/e2e-schema-validation.test.ts`
 * and `backend/test/type-contracts.test.ts`.
 */
import type { CallingApplication, DiagnosticLog } from './api';

/** `calling_applications` columns — no phantom name/slug/description/is_active. */
const CALLING_APPLICATION_FIELDS = ['id', 'display_name', 'workspace_id', 'created_at'] as const;

/** `diagnostic_logs` columns — aligns with DiagnosticLogRow + live schema. */
const DIAGNOSTIC_LOG_FIELDS = [
  'id',
  'processing_job_id',
  'chat_session_id',
  'calling_application',
  'status',
  'user_id',
  'auth_mode',
  'api_key_id',
  'request_payload',
  'supabase_timing',
  'llm_timing',
  'llm_request',
  'llm_response',
  'formatting_timing',
  'total_duration_ms',
  'error_message',
  'metadata',
  'workspace_id',
  'created_at',
] as const;

describe('CallingApplication contract (SD3)', () => {
  it('accepts only backend/DB fields', () => {
    const row = {
      id: 'cadence',
      display_name: 'Cadence',
      workspace_id: 'ws-1',
      created_at: '2024-01-01T00:00:00Z',
    };
    const app: CallingApplication = row;
    expect(Object.keys(app).sort()).toEqual([...CALLING_APPLICATION_FIELDS].sort());
    expect(app.display_name).toBe('Cadence');
  });

  it('does not declare removed phantom fields', () => {
    const phantoms = ['name', 'slug', 'description', 'is_active'] as const;
    const sample: CallingApplication = {
      id: 'x',
      display_name: 'x',
      workspace_id: 'ws',
      created_at: '2024-01-01T00:00:00Z',
    };
    for (const key of phantoms) {
      expect(Object.prototype.hasOwnProperty.call(sample, key)).toBe(false);
    }
  });
});

describe('DiagnosticLog contract (SD2)', () => {
  it('accepts a full backend/DB-shaped row', () => {
    const row = {
      id: 'diag-1',
      processing_job_id: 'job-1',
      chat_session_id: null,
      calling_application: 'cadence',
      status: 'success',
      user_id: null,
      auth_mode: 'api_key',
      api_key_id: null,
      request_payload: { stepKey: 'analyze' },
      supabase_timing: [{ durationMs: 12, operation: 'select', success: true }],
      llm_timing: { durationMs: 100, model: 'gpt', provider: 'openai' },
      llm_request: { model: 'gpt', provider: 'openai' },
      llm_response: { rawContent: '{}', usage: { total_tokens: 10 } },
      formatting_timing: { durationMs: 5, rulesApplied: 1 },
      total_duration_ms: 120,
      error_message: null,
      metadata: { primaryModel: 'gpt' },
      workspace_id: 'ws-1',
      created_at: '2024-01-01T00:00:00Z',
    };
    const log: DiagnosticLog = row;
    expect(Object.keys(log).sort()).toEqual([...DIAGNOSTIC_LOG_FIELDS].sort());
    expect(log.request_payload?.stepKey).toBe('analyze');
    expect(log.error_message).toBeNull();
  });

  it('does not rely on removed phantom text columns', () => {
    const phantoms = ['input_text', 'output_text', 'formatted_text'] as const;
    const sample: DiagnosticLog = {
      id: 'd',
      status: 'success',
      workspace_id: 'ws',
      created_at: '2024-01-01T00:00:00Z',
    };
    for (const key of phantoms) {
      expect(Object.prototype.hasOwnProperty.call(sample, key)).toBe(false);
    }
  });
});
