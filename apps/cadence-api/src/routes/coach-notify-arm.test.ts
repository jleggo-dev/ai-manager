/**
 * POST /coach/sessions/:id/notify-on-reply — "I'm leaving; tell me when she's done."
 *
 * The bug this pins (owner, device round 2026-08-16): push worked end to end, a real APNs delivery
 * had landed, and a registered device sat in `cadence.device_tokens` — but backgrounding the app
 * mid-reply produced nothing, and `cadence.notifications` recorded no attempt at all. Not a failed
 * send, not a skipped row: the push was never reached for.
 *
 * The route was refusing. It armed only when `in_flight_response_id` was already on the row, and
 * that column is written from the relay's `onResponseId` — which fires once UPSTREAM announces an
 * id, in a write that is deliberately fire-and-forget. Null for the whole opening stretch of every
 * turn, which is exactly when somebody backgrounds an app. It answered 200 `{armed:false}`, the
 * client throws the body away, and iOS had not killed the socket yet, so `clientAlive` was still
 * true and both halves of the `(armed || !clientAlive)` gate were false.
 *
 * So: arming no longer asks whether a turn is generating. Keeping an arm from outliving its turn is
 * the start of the NEXT turn's job (`setNotifyOnReply(false)` beside `touchConversation`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const getConversationByAiSession = vi.fn();
const setNotifyOnReply = vi.fn();

vi.mock('../repos/conversations.ts', () => ({
  getConversationByAiSession: (...a: unknown[]) => getConversationByAiSession(...a),
  setNotifyOnReply: (...a: unknown[]) => setNotifyOnReply(...a),
  getNotifyOnReply: vi.fn(),
  createConversation: vi.fn(),
  getLatestConversation: vi.fn(),
  setInFlightResponse: vi.fn(),
  touchConversation: vi.fn(),
}));
vi.mock('../ai/aim.ts', () => ({
  AimError: { fromUnknown: (e: unknown) => ({ kind: 'upstream', message: String(e), httpStatus: 502 }) },
  cancelCoachTurn: vi.fn(),
  openCoachSession: vi.fn(),
  injectCoachContext: vi.fn(),
  sendCoachMessage: vi.fn(),
  recordCoachReply: vi.fn(),
  getCoachPersona: vi.fn(),
  getCoachHistory: vi.fn(),
}));
// Everything below is only imported for the routes this file does not exercise; mocked so the
// module graph stays as shallow as it can (mirrors coach-stop.test.ts).
vi.mock('../services/plan-ready-push.ts', () => ({ sendPlanReadyPush: vi.fn() }));
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

async function arm(sessionId: string) {
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/coach/sessions/${sessionId}/notify-on-reply`, {
      method: 'POST',
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

describe('POST /coach/sessions/:id/notify-on-reply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setNotifyOnReply.mockResolvedValue(undefined);
  });

  /**
   * THE regression. Backgrounding four seconds into a thirty-second turn is the case the whole
   * feature exists for, and it is the case where upstream has not announced a response id yet.
   */
  it('arms a turn that has not been given a response id yet', async () => {
    getConversationByAiSession.mockResolvedValue({ user_id: 'u1', in_flight_response_id: null });
    const res = await arm('sess-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ armed: true });
    expect(setNotifyOnReply).toHaveBeenCalledWith('sess-1', true);
  });

  it('arms a turn that already has one', async () => {
    getConversationByAiSession.mockResolvedValue({ user_id: 'u1', in_flight_response_id: 'resp_live' });
    expect((await arm('sess-1')).body).toEqual({ armed: true });
    expect(setNotifyOnReply).toHaveBeenCalledWith('sess-1', true);
  });

  it("refuses a session that belongs to somebody else, and doesn't say it exists", async () => {
    // Ownership is the one check that has to stay: this aims a notification at a person.
    getConversationByAiSession.mockResolvedValue({ user_id: 'someone-else', in_flight_response_id: 'resp_live' });
    expect((await arm('sess-of-theirs')).status).toBe(404);
    expect(setNotifyOnReply).not.toHaveBeenCalled();
  });

  it('404s an unknown session', async () => {
    getConversationByAiSession.mockResolvedValue(null);
    expect((await arm('nope')).status).toBe(404);
    expect(setNotifyOnReply).not.toHaveBeenCalled();
  });

  it('soft-fails a write that blows up rather than 500ing at a backgrounded phone', async () => {
    getConversationByAiSession.mockResolvedValue({ user_id: 'u1', in_flight_response_id: null });
    setNotifyOnReply.mockRejectedValue(new Error('db went away'));
    const res = await arm('sess-1');
    expect(res.status).toBe(200);
    expect(res.body.armed).toBe(false);
  });
});
