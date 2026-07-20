/**
 * API-P2 — situation assess gate (weekly interval, pending proposal, tripwire→Broker).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const setPendingProposal = vi.fn();
const touchAssessedAt = vi.fn();
const getActivePlan = vi.fn();
const listOccurrences = vi.fn();
const runJob = vi.fn();
const detectTripwires = vi.fn();
const rollingConsistency = vi.fn();

vi.mock('../repos/users.ts', () => ({
  getUser: (...a: unknown[]) => getUser(...a),
  setPendingProposal: (...a: unknown[]) => setPendingProposal(...a),
  touchAssessedAt: (...a: unknown[]) => touchAssessedAt(...a),
}));
vi.mock('../repos/plans.ts', () => ({
  getActivePlan: (...a: unknown[]) => getActivePlan(...a),
}));
vi.mock('../repos/occurrences.ts', () => ({
  listOccurrences: (...a: unknown[]) => listOccurrences(...a),
}));
vi.mock('../ai/aim.ts', () => ({
  runJob: (...a: unknown[]) => runJob(...a),
}));
vi.mock('../config.ts', () => ({
  cadenceConfig: { aim: { jobs: { situationAssess: 'job-situation' } } },
}));
vi.mock('./tripwires.ts', () => ({
  detectTripwires: (...a: unknown[]) => detectTripwires(...a),
}));
vi.mock('./metrics.ts', () => ({
  rollingConsistency: (...a: unknown[]) => rollingConsistency(...a),
}));

import { assessIfDue } from './situation.ts';

const USER = '00000000-0000-4000-a000-00000000a201';

describe('assessIfDue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    rollingConsistency.mockReturnValue({ kept: 5, window: 7 });
    listOccurrences.mockResolvedValue([]);
    getActivePlan.mockResolvedValue({ plan_id: 'p1' });
    touchAssessedAt.mockResolvedValue(undefined);
    setPendingProposal.mockResolvedValue(undefined);
  });

  it('no-ops when user missing, pending proposal outstanding, or no plan', async () => {
    getUser.mockResolvedValueOnce(null);
    await assessIfDue(USER);
    expect(touchAssessedAt).not.toHaveBeenCalled();

    getUser.mockResolvedValueOnce({ pending_proposal: { reason: 'x' }, last_assessed_at: null });
    await assessIfDue(USER);
    expect(getActivePlan).not.toHaveBeenCalled();

    getUser.mockResolvedValueOnce({ pending_proposal: null, last_assessed_at: null, steer_back: null });
    getActivePlan.mockResolvedValueOnce(null);
    await assessIfDue(USER);
    expect(touchAssessedAt).not.toHaveBeenCalled();
  });

  it('skips when last assessed within 7 days', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00.000Z'));
    getUser.mockResolvedValue({
      pending_proposal: null,
      last_assessed_at: '2026-07-18T12:00:00.000Z',
      steer_back: null,
    });
    await assessIfDue(USER);
    expect(getActivePlan).not.toHaveBeenCalled();
    expect(touchAssessedAt).not.toHaveBeenCalled();
  });

  it('advances the gate without Broker when no tripwires fire', async () => {
    getUser.mockResolvedValue({ pending_proposal: null, last_assessed_at: null, steer_back: null });
    detectTripwires.mockReturnValue([]);
    await assessIfDue(USER);
    expect(touchAssessedAt).toHaveBeenCalledWith(USER);
    expect(runJob).not.toHaveBeenCalled();
    expect(setPendingProposal).not.toHaveBeenCalled();
  });

  it('stores a pending proposal when Broker recommends a re-plan', async () => {
    getUser.mockResolvedValue({ pending_proposal: null, last_assessed_at: null, steer_back: null });
    detectTripwires.mockReturnValue(['missed_streak']);
    runJob.mockResolvedValue({
      formatted: JSON.stringify({
        recommend_replan: true,
        reason: 'Missed several days',
        suggested_levers: ['ease volume', 42],
      }),
    });
    await assessIfDue(USER);
    expect(runJob).toHaveBeenCalledWith(USER, 'job-situation', expect.any(Object));
    expect(setPendingProposal).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({
        reason: 'Missed several days',
        suggested_levers: ['ease volume'],
      }),
    );
  });

  it('does not store a proposal when Broker says no re-plan', async () => {
    getUser.mockResolvedValue({ pending_proposal: null, last_assessed_at: null, steer_back: null });
    detectTripwires.mockReturnValue(['dip']);
    runJob.mockResolvedValue({ formatted: JSON.stringify({ recommend_replan: false }) });
    await assessIfDue(USER);
    expect(setPendingProposal).not.toHaveBeenCalled();
  });
});
