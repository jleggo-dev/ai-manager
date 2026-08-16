import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The FLOOR — what the coach is guaranteed to be holding when she reads a turn.
 *
 * `context-select` is the cheapest model in the stack deciding what the strongest one needs, and
 * it used to have a veto: return nothing and the turn ran on whatever the session-open pack
 * happened to hold. A select that FAILED took the same path as one that deliberately chose
 * nothing, so a silent breakage and a considered decision were indistinguishable.
 *
 * It fired on 2026-08-16 — "let's start by changing the farmer carries to dead hangs" selected
 * nothing, on the exact turn where naming the commitment as the plan lists it is the whole job.
 *
 * These tests exist because that failure is invisible: nothing errors, nothing logs a fault, the
 * coach simply knows less than she should and answers anyway.
 */

const runJobBySlug = vi.fn();
const injectCoachContext = vi.fn();
const getCoachHistory = vi.fn();
const executeCalls = vi.fn();
const renderCatalogDoc = vi.fn();

vi.mock('../ai/aim.ts', () => ({
  runJobBySlug: (...a: unknown[]) => runJobBySlug(...a),
  injectCoachContext: (...a: unknown[]) => injectCoachContext(...a),
  getCoachHistory: (...a: unknown[]) => getCoachHistory(...a),
}));
vi.mock('./retrieval/catalog.ts', () => ({ renderCatalogDoc: (...a: unknown[]) => renderCatalogDoc(...a) }));
vi.mock('./retrieval/select-and-run.ts', async () => {
  const actual = await vi.importActual<typeof import('./retrieval/select-and-run.ts')>('./retrieval/select-and-run.ts');
  return { ...actual, executeCalls: (...a: unknown[]) => executeCalls(...a) };
});
vi.mock('./dev-trace.ts', () => ({ updateTrace: vi.fn() }));
vi.mock('./ai-log.ts', () => ({ logAi: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./retrieval/registry.ts', () => ({
  RETRIEVAL_FUNCTIONS: {
    get_identity: { name: 'get_identity', render: () => 'Name: Jeffrey', rows: () => 1 },
    get_constraints: { name: 'get_constraints', render: () => 'What we work around: knee; elbow', rows: () => 2 },
    get_active_plan: { name: 'get_active_plan', render: () => 'Current plan v1 (15 commitments)', rows: () => 15 },
    get_recent_logs: { name: 'get_recent_logs', render: () => 'Recent: a long run', rows: () => 1 },
  },
}));

const { injectTurnContext } = await import('./turn-context.ts');

/** The calls the floor + selection produced, as plain names. */
const calledFns = (): string[] => ((executeCalls.mock.calls[0]?.[1] ?? []) as Array<{ fn: string }>).map((c) => c.fn);

/** The text actually injected into the session. */
const injectedBlock = (): string => String(injectCoachContext.mock.calls[0]?.[2] ?? '');

beforeEach(() => {
  vi.clearAllMocks();
  renderCatalogDoc.mockResolvedValue('(catalog)');
  getCoachHistory.mockResolvedValue({ messages: [] });
  executeCalls.mockImplementation(async (_u: string, calls: Array<{ fn: string; params: unknown }>) => ({
    results: Object.fromEntries(calls.map((c) => [c.fn, {}])),
    provenance: calls.map((c) => ({ fn: c.fn, params: c.params, rows: 1, at: 'now' })),
  }));
  injectCoachContext.mockResolvedValue(undefined);
});

describe('the turn-context floor', () => {
  it('injects identity, constraints and the plan even when the Broker chooses nothing', async () => {
    runJobBySlug.mockResolvedValue({ formatted: JSON.stringify({ calls: [], reason: 'nothing needed' }) });

    await injectTurnContext('u1', 's1', "let's change the farmer carries to dead hangs");

    expect(calledFns()).toEqual(['get_identity', 'get_constraints', 'get_active_plan']);
    expect(injectCoachContext).toHaveBeenCalledTimes(1);
    expect(injectedBlock()).toContain('Current plan v1');
  });

  /** A select that threw must not cost her the floor — that was the whole silent-failure path. */
  it('injects the floor when the Broker call fails outright', async () => {
    runJobBySlug.mockRejectedValue(new Error('provider 500'));

    await injectTurnContext('u1', 's1', 'how am I doing?');

    expect(calledFns()).toEqual(['get_identity', 'get_constraints', 'get_active_plan']);
    expect(injectedBlock()).toContain('What we work around');
  });

  it('injects the floor when the Broker returns malformed output', async () => {
    runJobBySlug.mockResolvedValue({ formatted: 'not json at all' });

    await injectTurnContext('u1', 's1', 'hello');

    expect(calledFns()).toEqual(['get_identity', 'get_constraints', 'get_active_plan']);
  });

  it('adds the Broker’s picks on top of the floor, never instead of it', async () => {
    runJobBySlug.mockResolvedValue({
      formatted: JSON.stringify({
        calls: [{ fn: 'get_recent_logs', params: { days: 7 } }],
        reason: 'asked about runs',
      }),
    });

    await injectTurnContext('u1', 's1', 'how did my runs go?');

    expect(calledFns()).toEqual(['get_identity', 'get_constraints', 'get_active_plan', 'get_recent_logs']);
  });

  /** The Broker naming a floor function must not fetch it twice — and its params must not be
   *  silently dropped either, so the floor takes the slot and the duplicate is skipped. */
  it('does not fetch a floor function twice when the Broker also asks for it', async () => {
    runJobBySlug.mockResolvedValue({
      formatted: JSON.stringify({ calls: [{ fn: 'get_active_plan', params: {} }], reason: 'plan question' }),
    });

    await injectTurnContext('u1', 's1', 'what is my plan?');

    expect(calledFns()).toEqual(['get_identity', 'get_constraints', 'get_active_plan']);
  });

  it('drops a name the registry does not know rather than passing it through', async () => {
    runJobBySlug.mockResolvedValue({
      formatted: JSON.stringify({ calls: [{ fn: 'get_nonsense', params: {} }], reason: 'guessing' }),
    });

    await injectTurnContext('u1', 's1', 'anything');

    expect(calledFns()).toEqual(['get_identity', 'get_constraints', 'get_active_plan']);
  });

  /** Silent failure was the actual defect: the outcome is now the same, but the RECORD is not. */
  it('says in the injected block when the Broker failed, rather than reading as a clean decision', async () => {
    runJobBySlug.mockRejectedValue(new Error('provider 500'));
    await injectTurnContext('u1', 's1', 'hello');
    const failed = injectedBlock();

    vi.clearAllMocks();
    renderCatalogDoc.mockResolvedValue('(catalog)');
    getCoachHistory.mockResolvedValue({ messages: [] });
    injectCoachContext.mockResolvedValue(undefined);
    executeCalls.mockImplementation(async (_u: string, calls: Array<{ fn: string; params: unknown }>) => ({
      results: Object.fromEntries(calls.map((c) => [c.fn, {}])),
      provenance: calls.map((c) => ({ fn: c.fn, params: c.params, rows: 1, at: 'now' })),
    }));
    runJobBySlug.mockResolvedValue({ formatted: JSON.stringify({ calls: [], reason: '' }) });
    await injectTurnContext('u1', 's1', 'hello');

    expect(failed).not.toBe(injectedBlock());
    expect(failed).toMatch(/select failed/i);
  });

  it('never throws the turn away when injection itself fails', async () => {
    runJobBySlug.mockResolvedValue({ formatted: JSON.stringify({ calls: [], reason: '' }) });
    injectCoachContext.mockRejectedValue(new Error('aim down'));

    await expect(injectTurnContext('u1', 's1', 'hello')).resolves.toBeUndefined();
  });
});
