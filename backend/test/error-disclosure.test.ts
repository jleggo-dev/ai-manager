import { describe, it, expect } from 'vitest';
import { safeClientError, safeStatusError } from '../src/lib/safe-error.ts';

describe('safeClientError()', () => {
  it('returns safe message for constraint violation', () => {
    const err = new Error('duplicate key value violates unique constraint "providers_pkey"');
    expect(safeClientError(err, 'Operation failed')).toBe('Operation failed');
  });

  it('returns safe message for SQL relation error', () => {
    const err = new Error('relation "internal_table" does not exist');
    expect(safeClientError(err, 'Operation failed')).toBe('Operation failed');
  });

  it('strips Supabase internal errors', () => {
    const err = new Error('Supabase PostgREST error: column xyz of relation providers');
    expect(safeClientError(err, 'Failed')).toBe('Failed');
  });

  it('strips stack traces', () => {
    const err = new Error('at processTicksAndRejections (node:internal/process/task_queues:96:5)');
    expect(safeClientError(err, 'Failed')).toBe('Failed');
  });

  it('returns domain message for credential errors', () => {
    const err = new Error('This profile requires personal credentials for provider X');
    const result = safeClientError(err, 'fallback');
    expect(result).toBe('This AI profile requires personal credentials. Please configure your provider credentials.');
  });

  it('returns domain message for failover_provider_id errors', () => {
    const err = new Error('failover_provider_id must reference a valid provider');
    const result = safeClientError(err, 'fallback');
    expect(result).toBe('Failover provider configuration is invalid.');
  });

  it('returns domain message for not found errors', () => {
    const err = new Error('Profile with id xyz not found');
    const result = safeClientError(err, 'fallback');
    expect(result).toBe('The requested resource was not found.');
  });

  it('returns domain message for rate limit errors', () => {
    const err = new Error('Rate limit exceeded for workspace');
    const result = safeClientError(err, 'fallback');
    expect(result).toBe('Rate limit exceeded. Please try again later.');
  });

  it('returns fallback for unknown errors', () => {
    const err = new Error('some completely unknown error');
    expect(safeClientError(err, 'Something went wrong')).toBe('Something went wrong');
  });

  it('handles non-Error inputs', () => {
    expect(safeClientError('raw string error', 'fallback')).toBe('fallback');
    expect(safeClientError(42, 'fallback')).toBe('fallback');
    expect(safeClientError(null, 'fallback')).toBe('fallback');
  });

  it('never leaks constraint names', () => {
    const errors = [
      'duplicate key value violates unique constraint "uq_workflows_workspace_slug"',
      'violates foreign key constraint "fk_provider_id"',
      'ERROR: column "workspace_id" of relation "providers" already exists',
    ];

    for (const msg of errors) {
      const result = safeClientError(new Error(msg), 'Safe fallback');
      expect(result).toBe('Safe fallback');
      expect(result).not.toContain('constraint');
      expect(result).not.toContain('relation');
    }
  });
});

describe('safeStatusError()', () => {
  it('returns fallback for 500+ status', () => {
    const err = new Error('detailed internal error with constraint names');
    expect(safeStatusError(err, 500, 'Server error')).toBe('Server error');
    expect(safeStatusError(err, 502, 'Server error')).toBe('Server error');
  });

  it('returns safe message for 4xx status', () => {
    const err = new Error('failover_provider_id is required');
    expect(safeStatusError(err, 400, 'Bad request')).toBe('Failover provider configuration is invalid.');
  });

  it('returns fallback for 4xx when error contains internals', () => {
    const err = new Error('violates unique constraint on providers table');
    expect(safeStatusError(err, 409, 'Conflict')).toBe('Conflict');
  });
});
