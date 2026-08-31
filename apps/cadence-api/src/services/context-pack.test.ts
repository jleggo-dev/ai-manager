/**
 * API-06 — resilience-contract tests for buildContextPack.
 *
 * Modes since 2026-08-31 (persisted audit trail; historical `broker-` prefix kept on purpose):
 *   - broker-select  — pack-select chose the functions; the app rendered the words
 *   - deterministic  — select failed → intent selection + renderResults
 * There is deliberately NO summarize step any more (see context-pack.ts header): the body is
 * each function's own render(), and these tests pin that no pack-summarize job is ever invoked.
 *
 * AI seam + catalog + persist/trace/log are mocked so CI runs without Cadence DB / AIM secrets.
 * Retrieval registry is stubbed so executeCalls never hits Postgres.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const USER = '00000000-0000-4000-a000-00000000a106';

const stubs = vi.hoisted(() => {
  const make = (name: string, result: unknown, rendered: string) => ({
    name,
    description: name,
    domains: [],
    run: vi.fn(async () => result),
    render: vi.fn(() => rendered),
    rows: vi.fn(() => 1),
  });
  return {
    runJobBySlug: vi.fn(),
    renderCatalogDoc: vi.fn(async () => 'catalog-doc'),
    insertContextPack: vi.fn(async (_p: { sections?: { mode?: string } }) => 'pack-id'),
    // Default MISS so every pre-P3 test runs the build path untouched; reuse tests opt in per-test.
    getFreshContextPack: vi.fn(async (): Promise<unknown> => null),
    updateTrace: vi.fn(),
    logAi: vi.fn(),
    RETRIEVAL_FUNCTIONS: {
      get_identity: make('get_identity', { name: 'Ada' }, 'Name: Ada'),
      get_constraints: make('get_constraints', [], ''),
      get_objectives: make('get_objectives', [], ''),
      get_active_plan: make('get_active_plan', { plan: null, activities: [] }, ''),
      get_consistency: make('get_consistency', { days: 7, scheduled: 0, done: 0, pct: null }, ''),
      get_weight: make('get_weight', null, ''),
      get_equipment: make('get_equipment', [], ''),
    },
  };
});

vi.mock('../ai/aim.ts', () => ({ runJobBySlug: stubs.runJobBySlug }));
vi.mock('./retrieval/catalog.ts', () => ({ renderCatalogDoc: stubs.renderCatalogDoc }));
vi.mock('../repos/context-pack.ts', () => ({
  insertContextPack: stubs.insertContextPack,
  getFreshContextPack: stubs.getFreshContextPack,
}));
vi.mock('./dev-trace.ts', () => ({ updateTrace: stubs.updateTrace }));
vi.mock('./ai-log.ts', () => ({ logAi: stubs.logAi }));
vi.mock('./retrieval/registry.ts', () => ({ RETRIEVAL_FUNCTIONS: stubs.RETRIEVAL_FUNCTIONS }));
// Avoid coach-context → repos → sql/config when no Cadence DB env is present in CI.
vi.mock('./coach-context.ts', () => ({
  intentFraming: (intent: string, topic?: string) => `== SESSION INTENT: ${intent}${topic ? ` / ${topic}` : ''} ==`,
  onboardingReadiness: vi.fn(async () => ''),
  planGapNote: vi.fn(async () => ''),
  targetlessGoalNote: vi.fn(async () => ''),
}));

import { buildContextPack } from './context-pack.ts';

function selectOk(calls: Array<{ fn: string; params?: Record<string, unknown> }>, reason = 'broker pick') {
  return { formatted: JSON.stringify({ calls, reason }) };
}

describe('API-06 — buildContextPack 3-way fallback', () => {
  beforeEach(() => {
    stubs.runJobBySlug.mockReset();
    stubs.renderCatalogDoc.mockClear();
    stubs.insertContextPack.mockClear();
    stubs.updateTrace.mockClear();
    stubs.logAi.mockClear();
  });

  it('mode=broker-select when select succeeds — body is the deterministic render, summarize never runs', async () => {
    stubs.runJobBySlug.mockImplementation(async (_uid: string, slug: string) => {
      if (slug === 'pack-select')
        return selectOk([{ fn: 'get_identity' }, { fn: 'get_objectives' }], 'need identity + goals');
      throw new Error(`unexpected slug ${slug}`);
    });

    const pack = await buildContextPack(USER, 'ongoing');

    expect(pack.mode).toBe('broker-select');
    expect(pack.selectReason).toBe('need identity + goals');
    expect(pack.rendered).toContain('broker-select');
    // The body is render() output word for word — no model prose stands between data and coach.
    expect(pack.rendered).toContain('Name: Ada');
    expect(pack.id).toBe('pack-id');
    expect(stubs.insertContextPack).toHaveBeenCalledOnce();
    expect(stubs.insertContextPack.mock.calls[0]?.[0]?.sections?.mode).toBe('broker-select');
    // The 2026-08-31 contract: pack-summarize is GONE — it once asserted "no linked equipment"
    // about a domain it was never handed.
    const slugs = stubs.runJobBySlug.mock.calls.map((c) => c[1]);
    expect(slugs).not.toContain('pack-summarize');
  });

  it('mode=deterministic when select fails', async () => {
    stubs.runJobBySlug.mockImplementation(async () => {
      throw new Error('broker down');
    });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pack = await buildContextPack(USER, 'ongoing');
    spy.mockRestore();

    expect(pack.mode).toBe('deterministic');
    expect(pack.selectReason).toBe('(deterministic selection)');
    expect(pack.rendered).toContain('deterministic');
    expect(pack.rendered).toContain('Name: Ada');
    // Intent fallback still executed mandatory + ongoing selection against the stub registry.
    expect(pack.provenance.some((p) => p.fn === 'get_identity')).toBe(true);
    expect(pack.provenance.some((p) => p.fn === 'get_constraints')).toBe(true);
  });

  it('treats empty/unknown select calls as select failure → deterministic path', async () => {
    stubs.runJobBySlug.mockImplementation(async (_uid: string, slug: string) => {
      if (slug === 'pack-select') return { formatted: JSON.stringify({ calls: [{ fn: 'ghost' }], reason: 'bad' }) };
      throw new Error(`unexpected slug ${slug}`);
    });

    const pack = await buildContextPack(USER, 'ongoing');
    expect(pack.mode).toBe('deterministic');
    expect(pack.selectReason).toBe('(deterministic selection)');
  });

  it('always appends the mandatory fns — equipment included — even if the Broker omitted them', async () => {
    stubs.runJobBySlug.mockImplementation(async (_uid: string, slug: string) => {
      if (slug === 'pack-select') return selectOk([{ fn: 'get_objectives' }], 'objectives only');
      throw new Error(`unexpected slug ${slug}`);
    });

    const pack = await buildContextPack(USER, 'ongoing');
    const fns = pack.provenance.map((p) => p.fn);
    expect(fns).toContain('get_objectives');
    expect(fns).toContain('get_identity');
    expect(fns).toContain('get_constraints');
    // 2026-08-31: the select chose a list without equipment and the coach denied the user's
    // dumbbells for a session. Owned items are ~30 tokens; their absence broke "never makes
    // you repeat yourself".
    expect(fns).toContain('get_equipment');
  });
});

describe('P3 — pack reuse', () => {
  // Sibling describe → the API-06 beforeEach doesn't cover us; without this, the last build-path
  // test's calls leak into the "never called" assertions here.
  beforeEach(() => {
    stubs.runJobBySlug.mockReset();
    stubs.insertContextPack.mockClear();
    stubs.getFreshContextPack.mockClear();
  });

  it('a fresh pack short-circuits BOTH Broker calls and inserts nothing', async () => {
    stubs.getFreshContextPack.mockResolvedValueOnce({
      id: 'cached-1',
      rendered: '[context built 2026-08-04 · broker-curated · fns: get_identity]\n\nCACHED DOSSIER',
      provenance: [{ fn: 'get_identity', params: {}, rows: 1, at: '2026-08-04T10:00:00Z' }],
      builtAt: '2026-08-04T10:00:00Z',
      expiresAt: '2026-08-11T10:00:00Z',
    });
    const pack = await buildContextPack(USER, 'ongoing');
    expect(pack.mode).toBe('pack-reuse');
    expect(pack.rendered).toContain('CACHED DOSSIER');
    // The whole point: zero model calls, zero new rows.
    expect(stubs.runJobBySlug).not.toHaveBeenCalled();
    expect(stubs.insertContextPack).not.toHaveBeenCalled();
  });

  it('a miss (stale, expired, or touched) builds normally', async () => {
    stubs.getFreshContextPack.mockResolvedValueOnce(null);
    const pack = await buildContextPack(USER, 'ongoing');
    expect(pack.mode).not.toBe('pack-reuse');
    expect(stubs.insertContextPack).toHaveBeenCalled();
  });

  it('reuse asks for THIS intent — a disrupted session never gets an ongoing framing', async () => {
    stubs.getFreshContextPack.mockResolvedValueOnce(null);
    await buildContextPack(USER, 'disrupted');
    expect(stubs.getFreshContextPack).toHaveBeenCalledWith(USER, null, 'disrupted');
  });
});
