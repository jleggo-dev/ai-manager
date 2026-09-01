/**
 * The fan-out gate (separate from plan-fanout.test.ts, which exercises the real fan-out → reduce
 * pipeline with the AI seam mocked — this file mocks plan-synthesis itself to isolate the gate).
 * Fan-out is GENESIS-ONLY (docs/cadence/PLAN-CHANGES.md): an evolve is handed the current plan,
 * so coverage holds by construction and fanning out just multiplies a minutes-long call by the
 * goal count — the 2026-08-31 quadruple-synthesis incident. These tests pin the predicate so a
 * refactor cannot quietly re-open that door.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Goal } from '@cadence/shared';

// Mutable so each test can flip the kill switch without re-importing the module.
const config = { aim: { planFanout: true } };
const synthesizeAndVet = vi.fn();
const runSynthesize = vi.fn();

vi.mock('../config.ts', () => ({ cadenceConfig: config }));
vi.mock('./plan-synthesis.ts', () => ({
  synthesizeAndVet: (...a: unknown[]) => synthesizeAndVet(...a),
  runSynthesize: (...a: unknown[]) => runSynthesize(...a),
  finalizeCoverage: vi.fn(),
  commitActivities: vi.fn(),
}));

const { shouldFanout, planSynthesize } = await import('./plan-fanout.ts');

const goal = (id: string): Goal => ({ goal_id: id, title: `goal ${id}` }) as Goal;
const base = { baseline: {}, equipment: [] };

beforeEach(() => {
  vi.clearAllMocks();
  config.aim.planFanout = true;
});

describe('shouldFanout', () => {
  it('fans out at genesis with goals to coordinate', () => {
    expect(shouldFanout({ ...base, goals: [goal('a'), goal('b')] })).toBe(true);
    // An EMPTY current plan is still genesis — nothing to anchor an evolve on.
    expect(shouldFanout({ ...base, goals: [goal('a'), goal('b')], currentPlan: [] })).toBe(true);
  });

  it('never fans out an evolve — the current plan is the coverage anchor', () => {
    expect(shouldFanout({ ...base, goals: [goal('a'), goal('b')], currentPlan: [{ title: 'Easy run' }] })).toBe(false);
  });

  it('never fans out a single goal — nothing to reconcile', () => {
    expect(shouldFanout({ ...base, goals: [goal('a')] })).toBe(false);
  });

  it('respects the kill switch', () => {
    config.aim.planFanout = false;
    expect(shouldFanout({ ...base, goals: [goal('a'), goal('b')] })).toBe(false);
  });
});

describe('planSynthesize routing', () => {
  it('sends an evolve down the single-call path even with many goals', async () => {
    synthesizeAndVet.mockResolvedValue({ status: 'proposed', activities: [] });
    const opts = { ...base, goals: [goal('a'), goal('b'), goal('c')], currentPlan: [{ title: 'Easy run' }] };
    await planSynthesize('u1', opts);
    expect(synthesizeAndVet).toHaveBeenCalledWith('u1', opts);
    // The fan-out path would have called runSynthesize per goal; the single call never does here.
    expect(runSynthesize).not.toHaveBeenCalled();
  });
});
