import { describe, expect, it } from 'vitest';
import { computeAnalytics, validateAgainstExpectedSchema, fmtMs } from './analyticsCompute';
import type { DiagnosticLog } from '../../../types/api';

describe('fmtMs', () => {
  it('formats nullish as em dash', () => {
    expect(fmtMs(null)).toBe('—');
    expect(fmtMs(undefined)).toBe('—');
  });

  it('keeps sub-second values in ms', () => {
    expect(fmtMs(250)).toBe('250ms');
  });

  it('formats seconds with one decimal', () => {
    expect(fmtMs(1500)).toBe('1.5s');
  });
});

describe('validateAgainstExpectedSchema', () => {
  const schema = {
    fields: {
      name: { type: 'string', required: true, description: 'Name' },
      tags: { type: 'array', required: false, description: 'Tags' },
    },
  };

  it('rejects invalid JSON', () => {
    const result = validateAgainstExpectedSchema('not-json', schema);
    expect(result.jsonValid).toBe(false);
    expect(result.fieldsTotal).toBe(0);
  });

  it('scores populated fields and types', () => {
    const result = validateAgainstExpectedSchema(JSON.stringify({ name: 'Acme', tags: ['a'], extra: true }), schema);
    expect(result.jsonValid).toBe(true);
    expect(result.fieldsTotal).toBe(2);
    expect(result.fieldsPopulated).toBe(2);
    expect(result.fieldsCorrectType).toBe(2);
    expect(result.requiredPresent).toBe(1);
    expect(result.unexpectedFields).toBe(1);
  });

  it('strips markdown fences before parsing', () => {
    const result = validateAgainstExpectedSchema('```json\n{"name":"Acme"}\n```', schema);
    expect(result.jsonValid).toBe(true);
    expect(result.fieldsPopulated).toBe(1);
  });
});

describe('computeAnalytics', () => {
  it('returns hasData false for empty logs', () => {
    expect(computeAnalytics([], null).hasData).toBe(false);
  });

  it('aggregates speed and content from diagnostic logs', () => {
    const logs = [
      {
        status: 'success',
        llm_timing: { durationMs: 1000, model: 'gpt', provider: 'openai' },
        total_duration_ms: 1200,
        llm_response: {
          rawContent: JSON.stringify({ name: 'Acme', tags: [] }),
          finishReason: 'stop',
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        },
        metadata: {},
      },
      {
        status: 'error',
        llm_timing: { durationMs: 2000, model: 'gpt', provider: 'openai' },
        total_duration_ms: 2100,
        llm_response: {
          rawContent: JSON.stringify({ name: 'Beta', tags: ['x'] }),
          finishReason: 'stop',
          usage: { prompt_tokens: 12, completion_tokens: 22 },
        },
        metadata: { failoverUsed: 'true' },
      },
    ] as unknown as DiagnosticLog[];

    const schema = {
      fields: {
        name: { type: 'string', required: true },
        tags: { type: 'array', required: false },
      },
    };

    const analytics = computeAnalytics(logs, schema, null);
    expect(analytics.hasData).toBe(true);
    expect(analytics.logCount).toBe(2);
    expect(analytics.avgLlm).toBe(1500);
    expect(analytics.minLlm).toBe(1000);
    expect(analytics.maxLlm).toBe(2000);
    expect(analytics.errorRate).toBe(50);
    expect(analytics.totalFailoverCalls).toBe(1);
    expect(analytics.jsonParseRate).toBe(100);
    expect(analytics.fieldBreakdown?.length).toBe(2);
  });
});
