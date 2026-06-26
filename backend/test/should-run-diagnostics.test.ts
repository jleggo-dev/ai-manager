import { describe, it, expect } from 'vitest';
import { shouldRunDiagnostics } from '../src/services/ai-diagnostics.ts';

describe('shouldRunDiagnostics', () => {
  it('returns enabled + persist when advancedConfig is null (new default)', () => {
    const result = shouldRunDiagnostics(null);
    expect(result).toEqual({ enabled: true, persist: true });
  });

  it('returns enabled + persist when diagnostics key is absent', () => {
    const result = shouldRunDiagnostics({ timeout: { llmTimeoutMs: 5000 } });
    expect(result).toEqual({ enabled: true, persist: true });
  });

  it('returns disabled when explicitly set to enabled: false', () => {
    const result = shouldRunDiagnostics({ diagnostics: { enabled: false } });
    expect(result).toEqual({ enabled: false, persist: false });
  });

  it('returns enabled + persist when mode is always', () => {
    const result = shouldRunDiagnostics({ diagnostics: { enabled: true, mode: 'always' } });
    expect(result).toEqual({ enabled: true, persist: true });
  });

  it('returns enabled but not persist when mode is one-time', () => {
    const result = shouldRunDiagnostics({ diagnostics: { enabled: true, mode: 'one-time' } });
    expect(result).toEqual({ enabled: true, persist: false });
  });

  it('defaults to mode always when enabled but mode omitted', () => {
    const result = shouldRunDiagnostics({ diagnostics: { enabled: true } });
    expect(result).toEqual({ enabled: true, persist: true });
  });
});
