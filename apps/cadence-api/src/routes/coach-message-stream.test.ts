/**
 * POST /coach/sessions/:id/messages — the streaming halves Phase 3 added (PLAN-CHANGES.md).
 *
 * Two contracts are pinned here, both invisible to a unit test of any one service:
 *
 * 1. The `{"cadence":"stage","name":"reading"}` frame is the FIRST thing on the wire — written
 *    right after the SSE headers flush, before any pre-work. The stretch from route entry to the
 *    first token (block refresh, context select, the upstream request) routinely runs 5–15
 *    seconds, and before this frame it was bare typing dots.
 *
 * 2. The turn's own cost is recorded: `ms` clocked from ROUTE ENTRY (so the pre-work stretch is
 *    counted, not silently excluded), and `toolRounds`, which the loop has always measured and
 *    this route used to drop on the floor.
 *
 * The tool loop is mocked at the service layer (aim refuses network under vitest); its own frame
 * ordering is pinned in coach-tool-loop.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const sendCoachMessage = vi.fn();
const assembleTurn = vi.fn();
const relayCoachTurnWithTools = vi.fn();
const ensureDateStamped = vi.fn();
const logAi = vi.fn();
const recordCoachReply = vi.fn();
const anchorCoachThread = vi.fn();

vi.mock('../ai/aim.ts', () => ({
  AimError: {
    fromUnknown: (e: unknown) => ({ kind: 'upstream', message: String(e), httpStatus: 502 }),
  },
  openCoachSession: vi.fn(),
  injectCoachContext: vi.fn(async () => {}),
  sendCoachMessage: (...a: unknown[]) => sendCoachMessage(...a),
  submitCoachToolOutputs: vi.fn(),
  recordCoachReply: (...a: unknown[]) => recordCoachReply(...a),
  anchorCoachThread: (...a: unknown[]) => anchorCoachThread(...a),
  getCoachPersona: vi.fn(),
  cancelCoachTurn: vi.fn(),
}));
vi.mock('../services/coach-transcript.ts', () => ({
  readArchivedConversations: vi.fn(),
  readTranscript: vi.fn(async () => []),
}));
vi.mock('../services/coach-photo-attach.ts', () => ({ attachPhotoToTurn: vi.fn(async () => undefined) }));
vi.mock('../services/capture.ts', () => ({ runCaptureExtract: vi.fn(async () => ({ screened: [] })) }));
vi.mock('../services/coach-block-refresh.ts', () => ({
  injectCoachBlocks: vi.fn(async () => {}),
  refreshChangedBlocks: vi.fn(async () => {}),
}));
vi.mock('../services/goal-screen.ts', () => ({ renderScreenNotes: () => '' }));
vi.mock('../services/detour-capture.ts', () => ({ runDetourCapture: vi.fn(async () => ({ ran: false })) }));
vi.mock('../services/coach-context.ts', () => ({ assembleTurn: (...a: unknown[]) => assembleTurn(...a) }));
vi.mock('../services/coach-tool-loop.ts', () => ({
  relayCoachTurnWithTools: (...a: unknown[]) => relayCoachTurnWithTools(...a),
}));
vi.mock('../services/plan-ready-push.ts', () => ({ sendPlanReadyPush: vi.fn(async () => {}) }));
vi.mock('../services/coach-tools.ts', () => ({
  coachToolDefinitions: () => [],
  coachToolNames: () => new Set<string>(),
  executeCoachToolCalls: vi.fn(),
  revealedDefinitions: () => [],
}));
vi.mock('../services/context-pack.ts', () => ({ buildContextPack: vi.fn() }));
vi.mock('../services/date-context.ts', () => ({ ensureDateStamped: (...a: unknown[]) => ensureDateStamped(...a) }));
vi.mock('../services/dev-trace.ts', () => ({ getTrace: vi.fn(), updateTrace: vi.fn() }));
vi.mock('../services/ai-log.ts', () => ({ logAi: (...a: unknown[]) => logAi(...a), recentAiLog: vi.fn() }));
vi.mock('../repos/conversations.ts', () => ({
  createConversation: vi.fn(async () => {}),
  countConversationsBefore: vi.fn(async () => 0),
  getConversationByAiSession: vi.fn(),
  getLatestConversation: vi.fn(),
  getNotifyOnReply: vi.fn(async () => false),
  setInFlightResponse: vi.fn(async () => {}),
  setNotifyOnReply: vi.fn(async () => {}),
  touchConversation: vi.fn(async () => {}),
}));
vi.mock('../repos/plans.ts', () => ({ getActivePlan: vi.fn(), getFirstPlanCommitAt: vi.fn() }));
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

const STAGE_FRAME = 'data: {"cadence":"stage","name":"reading"}\n\n';

/** What the loop hands back for a finished turn — the route must carry, not curate, these. */
const turnResult = {
  content: 'Hello there',
  segments: ['Hello there'],
  promptTokens: 100,
  cachedPromptTokens: 60,
  completionTokens: 20,
  model: 'gpt-x',
  responseId: 'r1',
  currentResponseId: 'r1',
  firstTokenMs: 5,
  clientDropped: false,
  toolRounds: 2,
};

async function send(message = 'hi') {
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/coach/sessions/sess-1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    return { status: res.status, body: await res.text() };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureDateStamped.mockResolvedValue(undefined);
  assembleTurn.mockResolvedValue('assembled message');
  anchorCoachThread.mockResolvedValue(undefined);
  recordCoachReply.mockResolvedValue(undefined);
  logAi.mockResolvedValue(undefined);
  sendCoachMessage.mockResolvedValue({
    response: { body: null },
    sessionId: 'ai-sess-1',
    diagnosticSession: null,
    resolvedMessage: 'assembled message',
  });
  relayCoachTurnWithTools.mockImplementation(
    async (_userId: unknown, _body: unknown, _deps: unknown, options: { writeChunk?: (c: string) => void }) => {
      options?.writeChunk?.('data: {"choices":[{"delta":{"content":"Hello there"}}]}\n\n');
      options?.writeChunk?.('data: [DONE]\n\n');
      return { ...turnResult };
    },
  );
});

describe('the reading stage frame', () => {
  it('is the first thing on the wire, once, ahead of every token', async () => {
    const res = await send();
    expect(res.status).toBe(200);
    expect(res.body.startsWith(STAGE_FRAME)).toBe(true);
    expect(res.body.split('"cadence":"stage"').length - 1).toBe(1);
    // And the reply still arrives after it, terminal included.
    expect(res.body.indexOf('Hello there')).toBeGreaterThan(STAGE_FRAME.length - 1);
    expect(res.body).toContain('data: [DONE]');
  });

  it('is already on the wire when pre-work fails — proof it precedes the pre-work', async () => {
    // assembleTurn is pre-work: it runs before the model is ever called. If the stage frame were
    // written any later than "immediately after the headers flush", this body would hold only the
    // error frame.
    assembleTurn.mockRejectedValue(new Error('context select died'));
    const res = await send();
    expect(res.body.startsWith(STAGE_FRAME)).toBe(true);
    expect(res.body).toContain('"error":"stream failed"');
    expect(res.body.indexOf('"cadence":"stage"')).toBeLessThan(res.body.indexOf('stream failed'));
  });
});

describe('turn metrics', () => {
  /** The turn log lands AFTER the stream ends (bookkeeping never keeps a client waiting), so the
   *  fetch resolving does not mean the log exists yet — poll for it. */
  const waitForCoachLog = () =>
    vi.waitFor(() => {
      const call = logAi.mock.calls.find((c) => (c[1] as { kind?: string })?.kind === 'coach');
      expect(call).toBeDefined();
      return call!;
    });

  it('records ms from route entry and the toolRounds the loop reported', async () => {
    // 30ms of pre-work, upstream of the relay. A clock started at the relay call (the old t0)
    // would read ~0 here; the route-entry clock must count it.
    ensureDateStamped.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    await send();

    const coachLog = await waitForCoachLog();
    const meta = (coachLog[1] as { meta: Record<string, unknown> }).meta;
    expect(meta.toolRounds).toBe(2);
    expect(typeof meta.ms).toBe('number');
    expect(meta.ms as number).toBeGreaterThanOrEqual(25);
    // The rest of the turn's economics still ride along untouched.
    expect(meta.promptTokens).toBe(100);
    expect(meta.cachedPromptTokens).toBe(60);
    expect(meta.clientDropped).toBe(false);
  });

  it('a plain turn records toolRounds 0 rather than omitting it', async () => {
    relayCoachTurnWithTools.mockResolvedValue({ ...turnResult, toolRounds: 0 });
    await send();
    const coachLog = await waitForCoachLog();
    const meta = (coachLog[1] as { meta: Record<string, unknown> }).meta;
    expect(meta.toolRounds).toBe(0);
  });
});
