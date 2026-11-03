/**
 * GET /coach/current — `generating`, the word a phone that left mid-turn comes back for.
 *
 * It used to read only `in_flight_response_id`, which the relay writes once the provider announces
 * a response id — 5–15 s into the turn. A phone that backgrounded inside that stretch and came
 * back was told nothing was generating, and the client then said "connection dropped" while the
 * reply was on its way. `turn_started_at` (0065) is set at route entry, so the whole turn counts.
 * Both marks are bounded by age: a turn that died with its instance never clears them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const getLatestConversation = vi.fn();

vi.mock('../repos/conversations.ts', () => ({
  getLatestConversation: (...a: unknown[]) => getLatestConversation(...a),
  countConversationsBefore: vi.fn(async () => 0),
  getConversationByAiSession: vi.fn(),
  createConversation: vi.fn(),
  getNotifyOnReply: vi.fn(),
  setInFlightResponse: vi.fn(),
  setNotifyOnReply: vi.fn(),
  startTurn: vi.fn(),
  endTurn: vi.fn(),
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
vi.mock('../services/coach-transcript.ts', () => ({
  readArchivedConversations: vi.fn(),
  readTranscript: vi.fn(async () => [{ role: 'user', content: 'what should I eat tonight?' }]),
}));
// Only imported for the routes this file does not exercise (mirrors coach-stop.test.ts).
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

async function current(): Promise<Record<string, unknown>> {
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/coach/current`);
    return (await res.json()) as Record<string, unknown>;
  } finally {
    server.close();
  }
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const conversation = (over: Record<string, unknown>) => ({
  conversation_id: 'c1',
  user_id: 'u1',
  ai_session_id: 'sess-1',
  external_chat_id: null,
  created_at: ago(3 * 86_400_000),
  updated_at: ago(10_000),
  in_flight_response_id: null,
  turn_started_at: null,
  ...over,
});

describe('GET /coach/current — generating', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['a turn marked at route entry, no response id yet (the opening stretch)', { turn_started_at: ago(4_000) }, true],
    [
      'a response id with the turn start (mid-reply)',
      { turn_started_at: ago(20_000), in_flight_response_id: 'r1' },
      true,
    ],
    ['a response id alone, on a row written before 0065', { in_flight_response_id: 'r1' }, true],
    ['neither mark (idle)', {}, false],
    [
      'marks from a turn that died six minutes ago — a corpse, not a reply',
      { turn_started_at: ago(6 * 60_000), in_flight_response_id: 'r1', updated_at: ago(6 * 60_000) },
      false,
    ],
  ])('%s → %s', async (_name, over, expected) => {
    getLatestConversation.mockResolvedValueOnce(conversation(over));
    const body = await current();
    expect(body.ok).toBe(true);
    expect(body.generating).toBe(expected);
  });
});
