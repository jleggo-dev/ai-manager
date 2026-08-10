import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import {
  AimError,
  openCoachSession,
  injectCoachContext,
  sendCoachMessage,
  recordCoachReply,
  getCoachPersona,
  getCoachHistory,
} from '../ai/aim.ts';
import { runCaptureExtract } from '../services/capture.ts';
import { renderCapabilities } from '../services/coach-capabilities.ts';
import { renderPickProtocol } from '../services/coach-picks-protocol.ts';
import { renderScreenNotes } from '../services/goal-screen.ts';
import { runDetourCapture } from '../services/detour-capture.ts';
import { assembleTurn } from '../services/coach-context.ts';
import { relayAndAccumulate } from '../services/coach-stream.ts';
import { buildContextPack } from '../services/context-pack.ts';
import { ensureDateStamped } from '../services/date-context.ts';
import { getTrace, updateTrace } from '../services/dev-trace.ts';
import { logAi, recentAiLog } from '../services/ai-log.ts';
import { ensureHorizon } from '../services/plan-horizon.ts';
import { createConversation, getLatestConversation, touchConversation } from '../repos/conversations.ts';
import { getActivePlan, getFirstPlanCommitAt } from '../repos/plans.ts';

/**
 * Turns the app authored rather than the user. They must be invisible everywhere the conversation
 * is read back: in a restored transcript they render as a message in the user's own bubble that
 * they never wrote, and in the Broker's capture window they get extracted as something they said.
 *
 * `<context` is live — the injected packs. **`<open>` is legacy** and deliberately kept: the
 * client briefly opened onboarding by asking the model to speak first, and sessions created in
 * that window still carry the nudge. The opening question is a constant now
 * (`@cadence/shared`'s OPENING_QUESTION, painted client-side and never sent), so nothing new
 * writes one — but dropping the pattern would make those existing transcripts render wrong.
 */
const APP_AUTHORED = /^\s*<(context|open)\b/;

export const isRealTurn = (m: { role?: string; content?: string }) =>
  (m.role === 'user' || m.role === 'assistant') && !APP_AUTHORED.test(m.content ?? '');

/** Build the capture window from the FULL conversation (user + coach turns), excluding the
 *  app-authored turns above. Falls back to the latest message if history can't be read. */
async function captureWindow(userId: string, sessionId: string, latest: string): Promise<string> {
  try {
    const hist = (await getCoachHistory(userId, sessionId)) as { messages?: unknown; data?: unknown };
    const msgs = (hist.messages ?? hist.data ?? []) as Array<{ role?: string; content?: string }>;
    const w = msgs
      .filter(isRealTurn)
      .map((m) => `${m.role === 'assistant' ? 'Coach' : 'User'}: ${(m.content ?? '').trim()}`)
      .join('\n');
    return w || latest;
  } catch {
    return latest;
  }
}

const router = Router();
router.use(requireCadenceUser);

/**
 * POST /coach/sessions — open a Coach chat session GROUNDED in the user's dossier.
 * P0 of the context/memory architecture: the PERSONA is the cacheable system prefix
 * (owned by the coach job); the per-user CONTEXT (rebuilt from the structured store) is
 * injected as a separate end-of-prefix context turn — never in the system prompt — so
 * the persona prefix stays cacheable and the context is independently refreshable.
 */
router.post('/sessions', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { intent, topic, healthAvailable, healthAnswered } = req.body ?? {};
    // Roll the plan horizon forward (idempotent) whenever the user comes back to the coach —
    // this is the top-up that keeps a long/undated plan materialized ~2 weeks ahead. Best-effort.
    void ensureHorizon(userId).catch((e) => console.error('[ensureHorizon]', e));
    // Persona-only system prompt (from the coach job); no caller systemPrompt.
    const session = await openCoachSession(userId);
    // Build the context pack from the retrieval registry (P1) + inject as a non-triggering,
    // provenance-stamped turn. The pack is persisted (cadence.context_pack) for audit/reuse.
    const pack = await buildContextPack(userId, intent, topic);
    // Device-capability note (client-declared): lets the persona's goal-gated Apple Health offer
    // fire only where the permission card can actually appear (iOS shell, not yet answered).
    // No "Recent activity" block + no note = web/answered → the coach never mentions Apple Health.
    const rendered =
      healthAvailable === true
        ? `${pack.rendered}\nDevice: Apple Health is available on this device and the user has not shared activity yet.`
        : pack.rendered;
    await injectCoachContext(userId, session.sessionId, rendered, { source: 'registry-pack', version: 1 });
    // What this build can actually do (coach-capabilities.ts) + the session-tool catalog. Injected
    // rather than written into the persona because features ship in code and the persona is edited
    // in AI Admin — a hard-coded list drifts, and a coach that offers a feature the build lacks is
    // worse than one that says "not yet". Cheap and static, so it rides the same session-open turn.
    await injectCoachContext(userId, session.sessionId, renderCapabilities({ healthAvailable, healthAnswered }), {
      source: 'capabilities',
      version: 1,
    });
    // The quick-pick protocol (coach-picks-protocol.ts) — the format the client parses out of a
    // turn to render tappable answers, plus the suggested first-conversation running order. Same
    // reasoning as the capability manifest: the parser ships in code, so the format does too.
    await injectCoachContext(userId, session.sessionId, renderPickProtocol({ intent }), {
      source: 'pick-protocol',
      version: 1,
    });
    // Persist conversation_id <-> ai_session_id mapping (§C6).
    await createConversation(userId, session.sessionId, session.externalChatId).catch((e) =>
      console.error('[createConversation]', e),
    );
    res.json({ sessionId: session.sessionId, externalChatId: session.externalChatId });
  } catch (err) {
    const aim = AimError.fromUnknown(err);
    console.error('[POST /coach/sessions]', aim.kind, aim.message);
    res.status(aim.httpStatus).json({ error: 'Failed to open session', kind: aim.kind });
  }
});

/**
 * GET /coach/current — the user's most recent session + its chat history, so the UI can
 * RESTORE the conversation on refresh instead of showing a blank chat. Excludes the system
 * persona and the injected <context> turn — just the user/coach turns.
 *
 * Also computes the FRESHNESS policy (P3-lite), server-side so there's one clock and it's
 * curl-testable. `stale: true` tells the client to start a fresh thread (and not render the
 * old transcript — a visible transcript the new session can't see reads as amnesia):
 *  - 'idle'      — no message activity for >7 days (touchConversation feeds updated_at)
 *  - 'graduated' — the conversation predates the user's FIRST plan commit and a plan is now
 *                  active: onboarding chatter shouldn't be the ongoing coaching thread.
 * Deliberately NOT invalidated by re-plans: per-turn retrieval already feeds plan changes into
 * a live session, and killing the thread on every adjust would break continuity.
 */
const STALE_IDLE_MS = 7 * 86_400_000;
router.get('/current', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const conv = await getLatestConversation(userId);
    if (!conv) return void res.json({ sessionId: null, messages: [], stale: false });

    let stale = false;
    let staleReason: 'idle' | 'graduated' | null = null;
    const lastActive = new Date(conv.updated_at ?? conv.created_at).getTime();
    if (Number.isFinite(lastActive) && Date.now() - lastActive > STALE_IDLE_MS) {
      stale = true;
      staleReason = 'idle';
    } else {
      const [firstCommit, active] = await Promise.all([getFirstPlanCommitAt(userId), getActivePlan(userId)]);
      if (firstCommit && active && new Date(conv.created_at).getTime() < new Date(firstCommit).getTime()) {
        stale = true;
        staleReason = 'graduated';
      }
    }

    const hist = (await getCoachHistory(userId, conv.ai_session_id)) as { messages?: unknown; data?: unknown };
    const raw = (hist.messages ?? hist.data ?? []) as Array<{ role?: string; content?: string }>;
    const messages = raw
      .filter(isRealTurn)
      .map((m) => ({ role: m.role === 'assistant' ? 'coach' : 'user', content: m.content ?? '' }));
    res.json({ sessionId: conv.ai_session_id, messages, stale, staleReason });
  } catch (err) {
    const aim = AimError.fromUnknown(err);
    console.error('[GET /coach/current]', aim.kind, aim.message);
    // Soft-fail: a blank restore is better than a hard error on the chat entry path.
    res.json({ sessionId: null, messages: [], stale: false });
  }
});

/**
 * POST /coach/sessions/:id/messages — send a message; stream the Coach reply (SSE).
 * `assembleTurn` is the just-in-time injection hook (§4.3); ambient capture (Broker)
 * fires in parallel (§6.1). 409-safe: client disables send until it sees [DONE].
 */
router.post('/sessions/:id/messages', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const message: unknown = req.body?.message;
  if (typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'message (string) required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  (res as Response & { flushHeaders?: () => void }).flushHeaders?.();

  // Drop-resilient streaming: if the client disconnects mid-turn we keep draining the
  // upstream so the reply still completes + persists (the UI recovers it via /coach/current).
  let clientAlive = true;
  const markGone = () => {
    clientAlive = false;
  };
  res.on('close', markGone);
  res.on('error', markGone);

  try {
    // Message activity bumps the conversation's updated_at (idle-staleness signal). Fire-and-forget.
    void touchConversation(req.params.id as string).catch(() => {});
    await ensureDateStamped(userId, req.params.id as string).catch((e) => console.error('[ensureDateStamped]', e));
    const turnMessage = await assembleTurn(userId, req.params.id as string, message);
    const { response, sessionId, diagnosticSession, resolvedMessage } = await sendCoachMessage(
      userId,
      req.params.id as string,
      turnMessage,
    );

    // Relay upstream SSE bytes verbatim (upstream emits its own `data: [DONE]`) while
    // accumulating the assistant content + usage, so we can log the turn + diagnostics
    // to AI Admin after the stream (the in-process path must do this bookkeeping itself).
    const t0 = Date.now();
    const { content, promptTokens, completionTokens, model, responseId, firstTokenMs, clientDropped } =
      await relayAndAccumulate(response.body, {
        isClientAlive: () => clientAlive,
        writeChunk: (chunk) => {
          try {
            res.write(chunk);
          } catch {
            clientAlive = false;
            return false;
          }
        },
      });
    // writeChunk may have flipped clientAlive on a failed write; also honor stream result.
    if (clientDropped) clientAlive = false;
    if (clientAlive) {
      try {
        res.end();
      } catch {
        /* client already gone */
      }
    }

    // Persist the assistant turn + finalize diagnostics in AI Admin (fire-and-forget) —
    // ALWAYS, even if the client dropped, so a lost connection never loses the reply.
    // Skip only if the upstream produced nothing (avoids logging an empty turn).
    if (content.trim()) {
      recordCoachReply(userId, {
        sessionId,
        content,
        diag: diagnosticSession,
        metrics: { promptTokens, completionTokens, durationMs: Date.now() - t0, firstTokenMs },
        model,
        promptContent: resolvedMessage ?? message,
      }).catch((e) => console.error('[recordCoachReply]', e));
    }

    // Dev X-ray + durable log of the coach turn (responseId + drop flag aid diagnostics
    // and a future live re-attach via the v2 Responses API stream-reconnect).
    updateTrace(userId, { coach: { user: message, reply: content, model, promptTokens, completionTokens } });
    logAi(userId, {
      kind: 'coach',
      sessionId: req.params.id as string,
      input: { user: message },
      output: { reply: content },
      meta: { model, promptTokens, completionTokens, responseId, clientDropped },
    }).catch(() => {});

    // Ambient capture on the FULL conversation (§6.1) — not just the last message — so goals
    // aren't fragmented per-turn. Result recorded for the X-ray. The detour capture rides the
    // SAME window: the conversational door into disrupted mode (REQ4 path #2) — a deterministic
    // keyword gate inside decides whether its job runs at all, and it enters an episode only on
    // the user's explicit yes to the coach's offer. Both fire-and-forget: a detour landing one
    // turn late is fine; a chat turn blocking on either is not.
    captureWindow(userId, req.params.id as string, message)
      .then((window) => {
        runCaptureExtract(userId, { conversation_window: window })
          .then(async (r) => {
            updateTrace(userId, { capture: r });
            // Deterministic scope/safety screen fired on something they just said. Hand the coach
            // the note so the pushback happens in the conversation — a card quietly missing from
            // Review is exactly the "start over" feeling the brand promises never to cause.
            const notes = renderScreenNotes(r.screened);
            if (notes) {
              await injectCoachContext(userId, req.params.id as string, notes, {
                source: 'goal-screen',
                version: 1,
              }).catch((e) => console.error('[goal-screen inject]', e));
            }
          })
          .catch((e) => console.error('[capture_extract]', e));
        runDetourCapture(userId, window)
          .then((o) => {
            if (o.ran) console.log('[capture_detour]', o.reason);
          })
          .catch((e) => console.error('[capture_detour]', e));
      })
      .catch((e) => console.error('[capture_window]', e));
  } catch (err) {
    const aim = AimError.fromUnknown(err);
    console.error('[POST /coach/sessions/:id/messages]', aim.kind, aim.message);
    if (!res.headersSent) {
      res.status(aim.httpStatus).json({ error: 'stream failed', kind: aim.kind });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'stream failed', kind: aim.kind })}\n\n`);
      res.end();
    }
  }
});

/**
 * GET /coach/trace — dev X-ray: the last behind-the-scenes AI activity for this user
 * (context pack data + curation, prompts, coach reply, broker outputs). Dev-only view;
 * the persona is fetched fresh from the coach job so the panel shows the real system prompt.
 */
router.get('/trace', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const trace = getTrace(userId);
  let persona: string | null = null;
  try {
    persona = await getCoachPersona(userId);
  } catch (e) {
    console.error('[GET /coach/trace persona]', e);
  }
  res.json({ ...(trace ?? { empty: true }), persona });
});

/** GET /coach/log — recent durable AI-log entries (history of coach + broker + capture). */
router.get('/log', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json({ entries: await recentAiLog(userId, 30) });
  } catch (err) {
    const aim = AimError.fromUnknown(err);
    console.error('[GET /coach/log]', aim.kind, aim.message);
    res.json({ entries: [] });
  }
});

export default router;
