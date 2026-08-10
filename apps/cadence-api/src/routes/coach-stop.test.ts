/**
 * POST /coach/sessions/:id/stop — the Stop button's server half.
 *
 * Two things are worth pinning here. First, ownership: a session id is the only thing between one
 * user and another user's in-flight turn, and the id travels in the URL. Second, WHICH response
 * gets cancelled — Cadence streams in-process, so the chat session's `provider_metadata` holds an
 * older turn's id, and falling back to it would report a successful cancel while the live reply
 * carried on. The id the relay recorded on the conversation is the only correct target.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const getConversationByAiSession = vi.fn();
const cancelCoachTurn = vi.fn();

vi.mock('../repos/conversations.ts', () => ({
  getConversationByAiSession: (...a: unknown[]) => getConversationByAiSession(...a),
  createConversation: vi.fn(),
  getLatestConversation: vi.fn(),
  setInFlightResponse: vi.fn(),
  touchConversation: vi.fn(),
}));
vi.mock('../ai/aim.ts', () => ({
  AimError: {
    fromUnknown: (e: unknown) => ({ kind: 'upstream', message: String(e), httpStatus: 502 }),
  },
  cancelCoachTurn: (...a: unknown[]) => cancelCoachTurn(...a),
  openCoachSession: vi.fn(),
  injectCoachContext: vi.fn(),
  sendCoachMessage: vi.fn(),
  recordCoachReply: vi.fn(),
  getCoachPersona: vi.fn(),
  getCoachHistory: vi.fn(),
}));
// Everything below is only imported for the routes this file does not exercise; mocked so the
// module graph never reaches db/sql.ts (and its "set CADENCE_DB_PASSWORD").
vi.mock('../repos/plans.ts', () => ({ getActivePlan: vi.fn(), getFirstPlanCommitAt: vi.fn() }));
vi.mock('../services/capture.ts', () => ({ runCaptureExtract: vi.fn() }));
vi.mock('../services/coach-capabilities.ts', () => ({ renderCapabilities: () => '' }));
vi.mock('../services/coach-picks-protocol.ts', () => ({ renderPickProtocol: () => '' }));
vi.mock('../services/goal-screen.ts', () => ({ renderScreenNotes: () => '' }));
vi.mock('../services/detour-capture.ts', () => ({ runDetourCapture: vi.fn() }));
vi.mock('../services/coach-context.ts', () => ({ assembleTurn: vi.fn() }));
vi.mock('../services/coach-stream.ts', () => ({ relayAndAccumulate: vi.fn() }));
vi.mock('../services/context-pack.ts', () => ({ buildContextPack: vi.fn() }));
vi.mock('../services/date-context.ts', () => ({ ensureDateStamped: vi.fn() }));
vi.mock('../services/dev-trace.ts', () => ({ getTrace: vi.fn(), updateTrace: vi.fn() }));
vi.mock('../services/ai-log.ts', () => ({ logAi: vi.fn(), recentAiLog: vi.fn() }));
vi.mock('../services/plan-horizon.ts', () => ({ ensureHorizon: vi.fn() }));
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

const { default: coachRoutes } = await import('./coach.ts');

const app = express();
app.use(express.json());
app.use('/coach', coachRoutes);

async function stop(sessionId: string) {
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/coach/sessions/${sessionId}/stop`, { method: 'POST' });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

describe('POST /coach/sessions/:id/stop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cancelCoachTurn.mockResolvedValue({ cancelled: true, responseId: 'resp_live' });
  });

  it('cancels the response the relay recorded for this turn', async () => {
    getConversationByAiSession.mockResolvedValue({ user_id: 'u1', in_flight_response_id: 'resp_live' });
    const res = await stop('sess-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cancelled: true, responseId: 'resp_live' });
    expect(cancelCoachTurn).toHaveBeenCalledWith('u1', 'sess-1', 'resp_live');
  });

  it("refuses a session that belongs to somebody else, and doesn't say it exists", async () => {
    getConversationByAiSession.mockResolvedValue({ user_id: 'someone-else', in_flight_response_id: 'resp_live' });
    const res = await stop('sess-of-theirs');
    expect(res.status).toBe(404);
    expect(cancelCoachTurn).not.toHaveBeenCalled();
  });

  it('404s an unknown session', async () => {
    getConversationByAiSession.mockResolvedValue(null);
    expect((await stop('nope')).status).toBe(404);
    expect(cancelCoachTurn).not.toHaveBeenCalled();
  });

  it('cancels nothing when nothing is generating', async () => {
    // The alternative — falling back to the chat session's provider_metadata — would cancel an
    // OLDER response and report success for a turn that never stopped.
    getConversationByAiSession.mockResolvedValue({ user_id: 'u1', in_flight_response_id: null });
    const res = await stop('sess-idle');
    expect(res.body).toEqual({ cancelled: false, reason: 'nothing-in-flight' });
    expect(cancelCoachTurn).not.toHaveBeenCalled();
  });

  it('soft-fails when the upstream cancel errors', async () => {
    // The composer is already back in the user's hands by now: a failure here costs a wasted
    // generation, not a broken screen.
    getConversationByAiSession.mockResolvedValue({ user_id: 'u1', in_flight_response_id: 'resp_live' });
    cancelCoachTurn.mockRejectedValue(new Error('502 from provider'));
    const res = await stop('sess-1');
    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(false);
  });
});
