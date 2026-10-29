/**
 * GET /plan/occurrences/:id — the three answers the sheet tells apart: the detail, a 404 after a
 * replan, and the 503 `coach_unreachable` that replaced the generic 500 for a provider outage
 * (2026-10-28: 414 prescribe failures in a day all read as "Couldn't open this just now"). The
 * generic 500 stays for everything else. Everything below the route is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { CoachUnreachableError } from '../services/session-generate-retry.ts';

const getOccurrenceDetail = vi.fn();
const getGoal = vi.fn();

vi.mock('../services/session-generate.ts', () => ({
  getOccurrenceDetail: (...a: unknown[]) => getOccurrenceDetail(...a),
  prefetchImminentSessions: vi.fn(),
}));
vi.mock('../repos/goals.ts', () => ({ getGoal: (...a: unknown[]) => getGoal(...a) }));
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

const { default: routes } = await import('./plan.ts');

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const a = express();
  a.use('/plan', routes);
  const server = a.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /plan/occurrences/:id', () => {
  it('200 with the detail (and the goal area riding along)', async () => {
    getOccurrenceDetail.mockResolvedValue({ occurrence_id: 'o1', goal_id: 'g1', title: 'Piano' });
    getGoal.mockResolvedValue({ area: 'practice' });
    const r = await get('/plan/occurrences/o1');
    expect(r).toEqual({ status: 200, body: { occurrence_id: 'o1', goal_id: 'g1', title: 'Piano', area: 'practice' } });
    expect(getOccurrenceDetail).toHaveBeenCalledWith('u1', 'o1');
  });

  it('404 when the row is not this user’s (a replan replaced the day) — unchanged', async () => {
    getOccurrenceDetail.mockResolvedValue(null);
    const r = await get('/plan/occurrences/o1');
    expect(r).toEqual({ status: 404, body: { error: 'occurrence not found' } });
  });

  it('503 coach_unreachable when every attempt to reach the coach failed', async () => {
    getOccurrenceDetail.mockRejectedValue(
      new CoachUnreachableError(3, new Error('AI Admin POST /api/processing-jobs/x/test → 503: down')),
    );
    const r = await get('/plan/occurrences/o1');
    expect(r).toEqual({ status: 503, body: { error: 'coach_unreachable', attempts: 3 } });
  });

  it('the generic 500 stays for any other fault', async () => {
    getOccurrenceDetail.mockRejectedValue(new Error('db exploded'));
    const r = await get('/plan/occurrences/o1');
    expect(r).toEqual({ status: 500, body: { error: 'failed to load session' } });
  });
});
