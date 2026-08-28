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

  /**
   * MP0e — found by the 2026-08-23 gap-map audit. `results` is keyed by function NAME, so two
   * calls to the SAME read in one round (the model calling `check_food_sources` twice with two
   * different queries is the live case — `coach-tools.ts` batches a whole round through one
   * `executeCalls`) collide: `results[fn] = result` lets the second overwrite the first, and
   * whichever `toolCallId` gets rendered from `results[fn]` afterwards gets the WRONG call's
   * answer. `perCall` is the fix: positional, so each call keeps its own result regardless of
   * what any other call in the same round was named.
   */
  it('keeps two same-name calls with different params apart via perCall (MP0e)', async () => {
    registry.get_identity.run.mockResolvedValueOnce({ name: 'first' }).mockResolvedValueOnce({ name: 'second' });
    const { results, perCall } = await executeCalls('user-1', [
      { fn: 'get_identity', params: { q: 'a' } },
      { fn: 'get_identity', params: { q: 'b' } },
    ]);

    // The pre-existing map still collides by design — every current caller keeps this behaviour.
    expect(results.get_identity).toEqual({ name: 'second' });
    // perCall does not: each of the two calls kept the answer that was actually run for IT.
    expect(perCall).toEqual([
      { fn: 'get_identity', params: { q: 'a' }, result: { name: 'first' } },
      { fn: 'get_identity', params: { q: 'b' }, result: { name: 'second' } },
    ]);
  });

  it('perCall stays positional (same length + order as calls) across a mixed batch', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { perCall } = await executeCalls('user-1', [
      { fn: 'get_identity', params: {} },
      { fn: 'boom', params: {} },
      { fn: 'ghost', params: {} },
      { fn: 'get_constraints', params: {} },
    ]);
    spy.mockRestore();

    // Every input call gets an entry, in order — a caller can zip `calls[i]` with `perCall[i]`
    // without re-deriving anything by name, whatever happened to that particular call.
    expect(perCall.map((c) => c.fn)).toEqual(['get_identity', 'boom', 'ghost', 'get_constraints']);
    expect(perCall.map((c) => c.result)).toEqual([{ name: 'Ada' }, undefined, undefined, []]);
  });

  /**
   * `results[fn]` unset on a throw is depended on elsewhere — `check_food_sources` tells a
   * crashed lookup (`undefined`) apart from a considered "no query given" (`null`), and collapsing
   * them was a live bug (see `food-sources-function.ts`). `perCall[i].result` carries the exact
   * same `undefined`-means-fault meaning, so a future caller adopting it inherits the distinction
   * rather than having to relearn it.
   */
  it('a throwing run is undefined on perCall too, not swallowed into a false value', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { results, perCall } = await executeCalls('user-1', [{ fn: 'boom', params: {} }]);
    spy.mockRestore();

    expect(results.boom).toBeUndefined();
    expect('boom' in results).toBe(false);
    expect(perCall).toEqual([{ fn: 'boom', params: {}, result: undefined }]);
  });
});
