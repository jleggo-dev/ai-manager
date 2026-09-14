/**
 * `POST /plan/week-review/recap` (Progress Engine W2-1) — a NEW file rather than an addition to
 * week-review.test.ts, so the existing week-review route tests stay untouched (the check-in's ACT
 * layer is regression-sensitive and recently shipped). Same express-on-an-ephemeral-port harness
 * that file uses. `services/recap-write.ts` is mocked, so this never touches `cadence.recaps` —
 * the 0046 migration is not applied anywhere this suite runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const getUser = vi.fn();
const writeRecapForReview = vi.fn();
const restartActiveWeek = vi.fn();

vi.mock('../repos/users.ts', () => ({
  getUser: (...a: unknown[]) => getUser(...a),
  setPendingWeekReview: vi.fn(async (..._a: unknown[]) => {}),
}));
vi.mock('../repos/plans.ts', () => ({
  restartActiveWeek: (...a: unknown[]) => restartActiveWeek(...a),
}));
const ensureHorizon = vi.fn();
vi.mock('../services/plan-horizon.ts', () => ({
  // Mirrors plan-horizon.ts's real values — kept in sync by hand since this mock replaces the module.
  DEFAULT_HORIZON_DAYS: 7,
  writtenAheadDays: (view: number) => view + 7,
  ensureHorizon: (...a: unknown[]) => ensureHorizon(...a),
}));
vi.mock('../services/week-review-facts.ts', () => ({ buildWeekReviewFacts: vi.fn() }));
vi.mock('../services/week-review-write.ts', () => ({
  confirmSession: vi.fn(),
  toggleMealSlot: vi.fn(),
  toggleMindStep: vi.fn(),
}));
vi.mock('../services/recap-write.ts', () => ({
  writeRecapForReview: (...a: unknown[]) => writeRecapForReview(...a),
}));
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

const { default: weekReviewRoutes } = await import('./week-review.ts');

const REVIEW = { from: '2026-08-17', to: '2026-08-23', built_at: '2026-08-24T09:00:00.000Z' };

interface RouteResponse {
  status: number;
  body: Record<string, unknown>;
}

async function post(body?: Record<string, unknown>): Promise<RouteResponse> {
  const app = express();
  app.use(express.json());
  app.use('/plan', weekReviewRoutes);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/plan/week-review/recap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ pending_week_review: REVIEW, baseline: {} });
  writeRecapForReview.mockResolvedValue({ id: 'r1' });
  restartActiveWeek.mockResolvedValue(true);
  ensureHorizon.mockResolvedValue(12);
});

/**
 * The week a confirm starts has to have DAYS (owner, 2026-09-14). This was the one check-in exit
 * that never committed, and a commit was the only thing that wrote rows: the owner confirmed
 * "0 of 14 sessions" at 07:26 and opened a plan with nothing on today or any day after it. The
 * fill is a commit's own kind — the day they are standing in comes back in full.
 */
describe('POST /plan/week-review/recap — writes the week it starts', () => {
  it('fills the calendar through the week after the view, keeping today’s already-passed slots', async () => {
    const r = await post({ line: 'A steady week.' });
    expect(r.status).toBe(200);
    expect(ensureHorizon).toHaveBeenCalledWith('u1', 14, { keepElapsedToday: true });
  });

  it('writes the week AFTER the clock is reset, never before — the order the wall clears in', async () => {
    const order: string[] = [];
    restartActiveWeek.mockImplementation(async () => {
      order.push('clock');
      return true;
    });
    ensureHorizon.mockImplementation(async () => {
      order.push('horizon');
      return 12;
    });
    await post();
    expect(order).toEqual(['clock', 'horizon']);
  });

  it('writes nothing when nothing is pending — a 404 is not a started week', async () => {
    getUser.mockResolvedValue({ pending_week_review: null, baseline: {} });
    await post();
    expect(ensureHorizon).not.toHaveBeenCalled();
  });

  it('still confirms (200) when the fill fails — GET /plan tops the calendar up on the next load', async () => {
    ensureHorizon.mockRejectedValue(new Error('db down'));
    const r = await post();
    expect(r.status).toBe(200);
  });
});

/**
 * The week clock (0058): this route is the confirm-only server call — `dismiss` is shared with
 * "Not now" — so it is where "Confirm my week" starts the next week when there is nothing to
 * commit. The wall on the trail clears because of this line, and only this line.
 */
describe('POST /plan/week-review/recap — starts the next week', () => {
  it('resets the active plan week clock once the recap is written', async () => {
    const r = await post({ line: 'A steady week.' });
    expect(r.status).toBe(200);
    expect(restartActiveWeek).toHaveBeenCalledWith('u1');
  });

  it('never resets the clock when nothing is pending — a 404 is not a confirmed week', async () => {
    getUser.mockResolvedValue({ pending_week_review: null, baseline: {} });
    await post();
    expect(restartActiveWeek).not.toHaveBeenCalled();
  });

  it('never resets the clock when the recap itself fails — the confirm did not land', async () => {
    writeRecapForReview.mockRejectedValue(new Error('db down'));
    await post();
    expect(restartActiveWeek).not.toHaveBeenCalled();
  });

  it('still confirms (200) when the clock reset fails — the recap is the record, the wall can be cleared again', async () => {
    restartActiveWeek.mockRejectedValue(new Error('db down'));
    const r = await post();
    expect(r.status).toBe(200);
  });
});

describe('POST /plan/week-review/recap', () => {
  it('404s when nothing is pending — never writes a recap for a week nobody confirmed', async () => {
    getUser.mockResolvedValue({ pending_week_review: null, baseline: {} });
    const r = await post();
    expect(r.status).toBe(404);
    expect(writeRecapForReview).not.toHaveBeenCalled();
  });

  it('anchors on the CURRENT pending review, never a client-supplied window', async () => {
    const r = await post({ from: '1999-01-01', to: '1999-01-07' });
    expect(r.status).toBe(200);
    expect(writeRecapForReview).toHaveBeenCalledWith('u1', REVIEW, 'kg', undefined);
  });

  it('passes an optional line straight through', async () => {
    const r = await post({ line: 'A steady week.' });
    expect(r.status).toBe(200);
    expect(writeRecapForReview).toHaveBeenCalledWith('u1', REVIEW, 'kg', 'A steady week.');
  });

  it('resolves the unit from the user baseline (lbs -> lb)', async () => {
    getUser.mockResolvedValue({ pending_week_review: REVIEW, baseline: { weight_unit: 'lbs' } });
    await post();
    expect(writeRecapForReview).toHaveBeenCalledWith('u1', REVIEW, 'lb', undefined);
  });

  it('400s on an oversized line rather than writing a truncated one', async () => {
    const r = await post({ line: 'x'.repeat(501) });
    expect(r.status).toBe(400);
    expect(writeRecapForReview).not.toHaveBeenCalled();
  });

  it('500s and does not crash when the orchestrator throws', async () => {
    writeRecapForReview.mockRejectedValue(new Error('db down'));
    const r = await post();
    expect(r.status).toBe(500);
  });
});
