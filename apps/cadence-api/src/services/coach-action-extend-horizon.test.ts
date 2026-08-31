/**
 * `extend_horizon` — thin over `extendHorizon` (plan-horizon.ts), so what's tested here is the
 * translation contract: every outcome gets words she can act on, the parameter is validated
 * before anything runs, and the extended reply says the two facts that matter (how long, and
 * when the check-in now lands).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./plan-horizon.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./plan-horizon.ts')>()),
  extendHorizon: vi.fn(),
}));

import { extendHorizon } from './plan-horizon.ts';
import { EXTEND_HORIZON } from './coach-action-extend-horizon.ts';

beforeEach(() => {
  vi.mocked(extendHorizon).mockReset();
});

describe('extend_horizon', () => {
  it('passes the asked-for days through and reads the new end back', async () => {
    vi.mocked(extendHorizon).mockResolvedValue({
      status: 'extended',
      horizonDays: 14,
      endsOn: '2026-09-12',
      materialized: 9,
    });
    const out = await EXTEND_HORIZON.run('u1', { days: 14 });
    expect(extendHorizon).toHaveBeenCalledWith('u1', 14);
    expect(out).toContain('14 days');
    expect(out).toContain('2026-09-12');
  });

  it('refuses a missing or garbled length without calling the service', async () => {
    const out = await EXTEND_HORIZON.run('u1', {});
    expect(out).toContain('nothing changed');
    expect(extendHorizon).not.toHaveBeenCalled();
  });

  it('refuses past the cap in words, without calling the service', async () => {
    const out = await EXTEND_HORIZON.run('u1', { days: 60 });
    expect(out).toContain('nothing changed');
    expect(extendHorizon).not.toHaveBeenCalled();
  });

  it('no_plan says nothing was built and points at a first week', async () => {
    vi.mocked(extendHorizon).mockResolvedValue({ status: 'no_plan' });
    const out = await EXTEND_HORIZON.run('u1', { days: 14 });
    expect(out).toContain('no active plan');
  });

  it('unchanged reports the standing length so she can answer honestly', async () => {
    vi.mocked(extendHorizon).mockResolvedValue({ status: 'unchanged', horizonDays: 14, endsOn: '2026-09-12' });
    const out = await EXTEND_HORIZON.run('u1', { days: 10 });
    expect(out).toContain('already runs 14 days');
    expect(out).toContain('nothing changed');
  });
});
