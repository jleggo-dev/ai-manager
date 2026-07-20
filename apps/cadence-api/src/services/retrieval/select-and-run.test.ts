/**
 * API-06 — unit tests for shared validateCalls / executeCalls (retrieval semantic layer).
 * Registry is mocked so CI never needs Cadence DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const registry = vi.hoisted(() => {
  const make = (name: string, result: unknown = { ok: true }, rows = 1) => ({
    name,
    description: name,
    domains: [],
    run: vi.fn(async () => result),
    render: vi.fn(() => `${name}-rendered`),
    rows: vi.fn(() => rows),
  });
  return {
    get_identity: make('get_identity', { name: 'Ada' }),
    get_constraints: make('get_constraints', []),
    get_objectives: make('get_objectives', [{ title: 'run' }]),
    boom: {
      name: 'boom',
      description: 'throws',
      domains: [],
      run: vi.fn(async () => {
        throw new Error('db down');
      }),
      render: vi.fn(() => ''),
      rows: vi.fn(() => 0),
    },
  };
});

vi.mock('./registry.ts', () => ({
  RETRIEVAL_FUNCTIONS: registry,
}));

import { validateCalls, executeCalls } from './select-and-run.ts';

describe('validateCalls', () => {
  it('keeps registry-known calls and normalizes params', () => {
    const out = validateCalls([
      { fn: 'get_identity', params: { days: 7 } },
      { fn: 'get_constraints' },
      { fn: 'get_objectives', params: null },
      { fn: 'not_a_real_fn', params: {} },
      null,
      'nope',
      { fn: 12 },
    ]);
    expect(out).toEqual([
      { fn: 'get_identity', params: { days: 7 } },
      { fn: 'get_constraints', params: {} },
      { fn: 'get_objectives', params: {} },
    ]);
  });

  it('returns [] for non-arrays and empty selections', () => {
    expect(validateCalls(undefined)).toEqual([]);
    expect(validateCalls(null)).toEqual([]);
    expect(validateCalls({})).toEqual([]);
    expect(validateCalls([])).toEqual([]);
  });
});

describe('executeCalls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs each call, collects results + provenance', async () => {
    const at = '2026-07-20T12:00:00.000Z';
    const { results, provenance } = await executeCalls(
      'user-1',
      [
        { fn: 'get_identity', params: {} },
        { fn: 'get_objectives', params: { x: 1 } },
      ],
      { at, logLabel: 'test' },
    );

    expect(results).toEqual({
      get_identity: { name: 'Ada' },
      get_objectives: [{ title: 'run' }],
    });
    expect(provenance).toEqual([
      { fn: 'get_identity', params: {}, rows: 1, at },
      { fn: 'get_objectives', params: { x: 1 }, rows: 1, at },
    ]);
    expect(registry.get_identity.run).toHaveBeenCalledWith('user-1', {});
    expect(registry.get_objectives.run).toHaveBeenCalledWith('user-1', { x: 1 });
  });

  it('skips a throwing function and continues the rest', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { results, provenance } = await executeCalls(
      'user-1',
      [
        { fn: 'boom', params: {} },
        { fn: 'get_identity', params: {} },
      ],
      { at: 't0', logLabel: 'turn-context' },
    );
    spy.mockRestore();

    expect(results).toEqual({ get_identity: { name: 'Ada' } });
    expect(provenance.map((p) => p.fn)).toEqual(['get_identity']);
    expect(registry.boom.run).toHaveBeenCalledOnce();
  });

  it('ignores unknown fn names left in the call list', async () => {
    const { results, provenance } = await executeCalls('user-1', [
      { fn: 'ghost', params: {} },
      { fn: 'get_constraints', params: {} },
    ]);
    expect(Object.keys(results)).toEqual(['get_constraints']);
    expect(provenance).toHaveLength(1);
  });
});
