/**
 * The Week review routes: the pending pointer's own GET/POST pair, plus `facts` (check-in
 * rebuild, step 4) — the full week that pointer names, for the read-only review sheet. Same
 * express-on-an-ephemeral-port harness `notification-prefs.test.ts` uses. No clearMocks in
 * vitest config, so every mock gets a fresh default in `beforeEach` rather than relying on
 * call-count resets.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const getUser = vi.fn();
const setPendingWeekReview = vi.fn(async (..._a: unknown[]) => {});
const buildWeekReviewFacts = vi.fn();

vi.mock('../repos/users.ts', () => ({
  getUser: (...a: unknown[]) => getUser(...a),
  setPendingWeekReview: (...a: unknown[]) => setPendingWeekReview(...a),
}));
vi.mock('../services/week-review-facts.ts', () => ({
  buildWeekReviewFacts: (...a: unknown[]) => buildWeekReviewFacts(...a),
}));
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

const { default: weekReviewRoutes } = await import('./week-review.ts');

const REVIEW = { from: '2026-08-17', to: '2026-08-23', built_at: '2026-08-24T09:00:00.000Z' };
const FACTS = { period: { from: REVIEW.from, to: REVIEW.to }, days: [], weigh_in: null };

interface RouteResponse {
  status: number;
  body: Record<string, unknown>;
}

async function call(method: 'GET' | 'POST', path: string): Promise<RouteResponse> {
  const app = express();
  app.use(express.json());
  app.use('/plan', weekReviewRoutes);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
    return { status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ pending_week_review: REVIEW });
  buildWeekReviewFacts.mockResolvedValue(FACTS);
});

describe('GET /plan/week-review/pending', () => {
  it('returns the stored pointer', async () => {
    const r = await call('GET', '/plan/week-review/pending');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ review: REVIEW });
  });

  it('returns null rather than erroring when nothing is pending', async () => {
    getUser.mockResolvedValue({ pending_week_review: null });
    const r = await call('GET', '/plan/week-review/pending');
    expect(r.body).toEqual({ review: null });
  });
});

describe('POST /plan/week-review/dismiss', () => {
  it('clears the pointer', async () => {
    const r = await call('POST', '/plan/week-review/dismiss');
    expect(r.status).toBe(200);
    expect(setPendingWeekReview).toHaveBeenCalledWith('u1', null);
  });

  it('reports a storage failure instead of pretending it saved', async () => {
    setPendingWeekReview.mockRejectedValueOnce(new Error('db down'));
    const r = await call('POST', '/plan/week-review/dismiss');
    expect(r.status).toBe(500);
  });
});

describe('GET /plan/week-review/facts', () => {
  it('404s with no review pending, rather than guessing a window', async () => {
    getUser.mockResolvedValue({ pending_week_review: null });
    const r = await call('GET', '/plan/week-review/facts');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'no review pending' });
    expect(buildWeekReviewFacts).not.toHaveBeenCalled();
  });

  it('404s the same way when the user has never had one at all', async () => {
    getUser.mockResolvedValue(null);
    const r = await call('GET', '/plan/week-review/facts');
    expect(r.status).toBe(404);
  });

  it("builds the pointer's own window and returns both the pointer and the facts", async () => {
    const r = await call('GET', '/plan/week-review/facts');
    expect(r.status).toBe(200);
    expect(buildWeekReviewFacts).toHaveBeenCalledWith('u1', REVIEW.from, REVIEW.to);
    expect(r.body).toEqual({ review: REVIEW, facts: FACTS });
  });

  it('reports a failure instead of a half-built week', async () => {
    buildWeekReviewFacts.mockRejectedValueOnce(new Error('db down'));
    const r = await call('GET', '/plan/week-review/facts');
    expect(r.status).toBe(500);
  });
});
