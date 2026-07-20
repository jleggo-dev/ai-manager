/**
 * FE-10 contract: backend *Row types must match live DB columns.
 * Keep field lists in sync with e2e-schema-validation.test.ts and
 * frontend/src/types/api.contract.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { CallingApplicationRow, DiagnosticLogRow } from '../src/types.ts';

const CALLING_APPLICATION_FIELDS = ['id', 'display_name', 'workspace_id', 'created_at'] as const;

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

describe('CallingApplicationRow contract (SD3)', () => {
  it('matches calling_applications schema columns', () => {
    const row: CallingApplicationRow = {
      id: 'cadence',
      display_name: 'Cadence',
      workspace_id: 'ws-1',
      created_at: '2024-01-01T00:00:00Z',
    };
    expect(Object.keys(row).sort()).toEqual([...CALLING_APPLICATION_FIELDS].sort());
  });
});

describe('DiagnosticLogRow contract (SD2)', () => {
  it('matches diagnostic_logs schema columns (including FE timing/payload fields)', () => {
    const row: DiagnosticLogRow = {
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
      llm_timing: { durationMs: 100 },
      llm_request: { model: 'gpt' },
      llm_response: { rawContent: '{}' },
      formatting_timing: { durationMs: 5 },
      total_duration_ms: 120,
      error_message: null,
      metadata: { primaryModel: 'gpt' },
      workspace_id: 'ws-1',
      created_at: '2024-01-01T00:00:00Z',
    };
    expect(Object.keys(row).sort()).toEqual([...DIAGNOSTIC_LOG_FIELDS].sort());
  });

  it('does not declare removed phantom text columns', () => {
    const phantoms = ['input_text', 'output_text', 'formatted_text'] as const;
    const sample: DiagnosticLogRow = {
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
