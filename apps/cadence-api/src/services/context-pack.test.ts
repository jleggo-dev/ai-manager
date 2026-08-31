/**
 * API-06 — contract tests for buildContextPack.
 *
 * Since 2026-08-31 (second pass) the build path is fully deterministic:
 *   - deterministic — INTENT_SELECTION[intent] + the MANDATORY floor; the body is each
 *                     function's own render()
 *   - pack-reuse    — a fresh persisted pack served as-is (P3); inserts nothing
 * There is deliberately NO model call anywhere in this path any more (context-pack.ts header):
 * pack-summarize invented an absence it never checked, and pack-select omitted weight
 * (2026-08-14) and equipment (2026-08-31). These tests pin that runJobBySlug is never invoked.
 *
 * Persist/trace/log are mocked so CI runs without Cadence DB / AIM secrets; the retrieval
 * registry is stubbed so executeCalls never hits Postgres.
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
    insertContextPack: vi.fn(async (_p: { sections?: { mode?: string } }) => 'pack-id'),
    // Default MISS so every build-path test runs the build untouched; reuse tests opt in per-test.
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

// context-pack.ts no longer imports the AI seam at all; this mock stands guard so that if a
// model call ever creeps back into the module graph, the never-called assertions below fail.
vi.mock('../ai/aim.ts', () => ({ runJobBySlug: stubs.runJobBySlug }));
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

describe('API-06 — deterministic build path', () => {
  beforeEach(() => {
    stubs.runJobBySlug.mockReset();
    stubs.insertContextPack.mockClear();
    stubs.updateTrace.mockClear();
    stubs.logAi.mockClear();
  });

  it('built packs are mode=deterministic — body is render() output, zero model calls', async () => {
    const pack = await buildContextPack(USER, 'ongoing');

    expect(pack.mode).toBe('deterministic');
    expect(pack.selectReason).toBe('(deterministic selection)');
    expect(pack.rendered).toContain('deterministic');
    // The body is render() output word for word — no model prose stands between data and coach.
    expect(pack.rendered).toContain('Name: Ada');
    expect(pack.id).toBe('pack-id');
    expect(stubs.insertContextPack).toHaveBeenCalledOnce();
    expect(stubs.insertContextPack.mock.calls[0]?.[0]?.sections?.mode).toBe('deterministic');
    // The 2026-08-31 contract: no pack-select, no pack-summarize, no job of any kind.
    expect(stubs.runJobBySlug).not.toHaveBeenCalled();
  });

  it('mandatory fns always execute — identity, constraints, weight, equipment', async () => {
    const pack = await buildContextPack(USER, 'ongoing');
    const fns = pack.provenance.map((p) => p.fn);
    // The floor that pack-select twice failed to hold: weight (2026-08-14), equipment
    // (2026-08-31 — the coach denied the user's dumbbells for a session).
    expect(fns).toContain('get_identity');
    expect(fns).toContain('get_constraints');
    expect(fns).toContain('get_weight');
    expect(fns).toContain('get_equipment');
    // Plus the per-intent list itself.
    expect(fns).toContain('get_objectives');
  });

  it('every intent gets the mandatory floor, even lists that never named them', async () => {
    // The onboarding list carries no get_weight; the floor appends it anyway.
    const pack = await buildContextPack(USER, 'onboarding');
    const fns = pack.provenance.map((p) => p.fn);
    expect(fns).toContain('get_weight');
    expect(fns).toContain('get_constraints');
    expect(stubs.runJobBySlug).not.toHaveBeenCalled();
  });

  it('pack_select is still logged for audit continuity — now recording the deterministic pick', async () => {
    await buildContextPack(USER, 'ongoing');
    const call = stubs.logAi.mock.calls.find((c) => (c[1] as { kind?: string })?.kind === 'pack_select');
    expect(call).toBeDefined();
    const entry = call?.[1] as { output?: { deterministic?: boolean; fns?: string[] }; meta?: { mode?: string } };
    expect(entry.output?.deterministic).toBe(true);
    expect(entry.output?.fns).toContain('get_equipment');
    expect(entry.meta?.mode).toBe('deterministic');
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
