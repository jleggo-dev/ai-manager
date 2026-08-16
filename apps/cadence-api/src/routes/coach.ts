import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import {
  AimError,
  openCoachSession,
  injectCoachContext,
  sendCoachMessage,
  submitCoachToolOutputs,
  recordCoachReply,
  getCoachPersona,
  getCoachHistory,
  cancelCoachTurn,
} from '../ai/aim.ts';
import { runCaptureExtract } from '../services/capture.ts';
import { renderCapabilities } from '../services/coach-capabilities.ts';
import { renderPickProtocol } from '../services/coach-picks-protocol.ts';
import { renderScreenNotes } from '../services/goal-screen.ts';
import { runDetourCapture } from '../services/detour-capture.ts';
import { assembleTurn } from '../services/coach-context.ts';
import { relayCoachTurnWithTools } from '../services/coach-tool-loop.ts';
import { sendPlanReadyPush } from '../services/plan-ready-push.ts';
import { coachToolDefinitions, coachToolNames, executeCoachToolCalls } from '../services/coach-tools.ts';
import { buildContextPack } from '../services/context-pack.ts';
import { ensureDateStamped } from '../services/date-context.ts';
import { getTrace, updateTrace } from '../services/dev-trace.ts';
import { logAi, recentAiLog } from '../services/ai-log.ts';
import { ensureHorizon } from '../services/plan-horizon.ts';
import {
  createConversation,
  getConversationByAiSession,
  getLatestConversation,
  getNotifyOnReply,
  setInFlightResponse,
  setNotifyOnReply,
  touchConversation,
} from '../repos/conversations.ts';
import { getActivePlan, getFirstPlanCommitAt } from '../repos/plans.ts';

/**
 * Turns the app authored rather than the user. They must be invisible everywhere the conversation
 * is read back: in a restored transcript they render as a message in the user's own bubble that
 * they never wrote, and in the Broker's capture window they get extracted as something they said.
 *
 * `<context` and `<note>` are live — the injected packs, and the notes the app hands the coach
 * mid-conversation so she speaks to something that just happened (the Apple Health history a user
 * has this second agreed to share). **`<open>` is legacy** and deliberately kept: the
 * client briefly opened onboarding by asking the model to speak first, and sessions created in
 * that window still carry the nudge. The opening question is a constant now
 * (`@cadence/shared`'s OPENING_QUESTION, painted client-side and never sent), so nothing new
 * writes one — but dropping the pattern would make those existing transcripts render wrong.
 */
const APP_AUTHORED = /^\s*<(context|open|note)\b/;

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
/** Past this, an in-flight marker is a leftover from a turn that died, not a live reply. */
const IN_FLIGHT_MAX_MS = 5 * 60_000;

/**
 * The notification body: her opening sentence, so the lock screen carries the answer and not just
 * the fact that one exists. Trimmed at a sentence boundary where there is one within reason —
 * iOS truncates anyway, and a clean stop reads better than an ellipsis mid-word.
 */
export function firstLine(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  const stop = flat.search(/[.!?](\s|$)/);
  const cut = stop > 0 && stop < 140 ? flat.slice(0, stop + 1) : flat.slice(0, 140);
  return cut.length < flat.length && !/[.!?]$/.test(cut) ? `${cut.trimEnd()}…` : cut;
}
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
    // `generating`: a reply is STILL being written server-side (the relay drains dropped streams
    // to completion, and 0029 records which response is in flight). A phone that backgrounded
    // mid-turn polls this on return, and "still generating" means keep waiting — not "give up
    // after five seconds and tell them the connection dropped".
    //
    // Bounded by age, because the flag is only cleared by the handler that set it: an invocation
    // that dies mid-turn leaves it set FOREVER, and an unbounded read would then tell every
    // future recovery in this conversation to keep waiting on a turn that ended days ago. A real
    // turn takes ~30s, so anything older than this is a corpse, not a reply. (`updated_at` is
    // stamped by `touchConversation` when the turn is sent, which makes it the turn's start.)
    const startedMs = new Date(conv.updated_at ?? conv.created_at).getTime();
    const inFlightFresh = Number.isFinite(startedMs) && Date.now() - startedMs < IN_FLIGHT_MAX_MS;
    res.json({
      sessionId: conv.ai_session_id,
      messages,
      stale,
      staleReason,
      generating: conv.in_flight_response_id != null && inFlightFresh,
    });
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

  const sessionIdParam = req.params.id as string;
  try {
    // Message activity bumps the conversation's updated_at (idle-staleness signal). Fire-and-forget.
    void touchConversation(sessionIdParam).catch(() => {});
    await ensureDateStamped(userId, req.params.id as string).catch((e) => console.error('[ensureDateStamped]', e));
    const turnMessage = await assembleTurn(userId, req.params.id as string, message);
    // The coach's read tools ride the request; when she calls one, the loop below fulfills it
    // against the retrieval registry and pumps the continuation — "let me check your file",
    // literally (PLAN.md, the tool-loop coach).
    const { response, sessionId, diagnosticSession, resolvedMessage } = await sendCoachMessage(
      userId,
      req.params.id as string,
      turnMessage,
      coachToolDefinitions(),
    );

    // Relay upstream SSE bytes verbatim (upstream emits its own `data: [DONE]`) while
    // accumulating the assistant content + usage, so we can log the turn + diagnostics
    // to AI Admin after the stream (the in-process path must do this bookkeeping itself).
    const t0 = Date.now();
    const { content, promptTokens, completionTokens, model, responseId, firstTokenMs, clientDropped } =
      await relayCoachTurnWithTools(
        userId,
        response.body,
        {
          toolNames: coachToolNames(),
          execute: (calls) => executeCoachToolCalls(userId, calls),
          submit: async (respId, outputs) =>
            (await submitCoachToolOutputs(userId, sessionId, respId, outputs)).response.body,
          // A word in her ear when she looked a tool up and never ran it. <note> turns are
          // app-authored, so this never reaches the transcript or the capture window.
          nudge: async (text) =>
            (await sendCoachMessage(userId, sessionId, text, coachToolDefinitions())).response.body,
        },
        {
          isClientAlive: () => clientAlive,
          // Recorded mid-stream because that is the only moment it is useful: Stop needs the id of
          // the response generating RIGHT NOW. Fire-and-forget — bookkeeping for a button must never
          // interrupt the turn the user is waiting on.
          onResponseId: (id) =>
            void setInFlightResponse(sessionIdParam, id).catch((e) => console.error('[setInFlightResponse]', e)),
          writeChunk: (chunk) => {
            try {
              res.write(chunk);
            } catch {
              clientAlive = false;
              return false;
            }
          },
        },
      );
    /**
     * AWAITED, and that is the whole fix for the backgrounded phone.
     *
     * This used to be fire-and-forget "so the client isn't kept waiting", which sounds free and
     * is not: work started after the handler returns is racing the platform reclaiming the
     * instance, and with nobody left on the socket that race is lost — reliably. Probed against
     * the deployment 2026-08-14 (scratch harness, real JWT, stream killed at 2.5s): the reply
     * generated perfectly (1452 chars, `logAi` recorded it), the relay drained to completion —
     * and the assistant turn never reached AI Admin's history. The app came back to a
     * conversation missing her answer and said "connection dropped, send again". Same probe with
     * the client left connected persisted the reply in 5 seconds. That is the bug the user has
     * hit every time they switch apps mid-turn.
     *
     * Awaiting costs the person nothing: the client resolved this turn on the `data: [DONE]` the
     * relay already wrote, so every line below runs after her reply is on screen.
     */
    if (content.trim()) {
      try {
        await recordCoachReply(userId, {
          sessionId,
          content,
          diag: diagnosticSession,
          metrics: { promptTokens, completionTokens, durationMs: Date.now() - t0, firstTokenMs },
          model,
          promptContent: resolvedMessage ?? message,
        });
      } catch (e) {
        // Durably, because a console line on a reclaimed serverless instance is not evidence —
        // and this is the one failure that silently costs someone the reply they waited for.
        console.error('[recordCoachReply]', e);
        await logAi(userId, {
          kind: 'coach',
          sessionId: req.params.id as string,
          input: { user: message },
          output: { reply: content },
          meta: { persistFailed: true, error: String(e), responseId, clientDropped },
        }).catch(() => {});
      }
    }

    // Read BEFORE the turn's state is torn down: the client may have armed this at any point
    // while the reply was being written, and clearing it below is what keeps it from firing again.
    const armed = await getNotifyOnReply(sessionIdParam).catch(() => false);

    // Cleared only NOW, after the reply is safely on file. Clearing it first opened the exact
    // window this bug lived in: a returning client polls, sees `generating: false` with no new
    // message, and concludes the turn died — while it was still being written down.
    await setInFlightResponse(sessionIdParam, null).catch(() => {});
    if (armed) await setNotifyOnReply(sessionIdParam, false).catch(() => {});

    // writeChunk may have flipped clientAlive on a failed write; also honor stream result.
    if (clientDropped) clientAlive = false;
    if (clientAlive) {
      try {
        res.end();
      } catch {
        /* client already gone */
      }
    }

    /**
     * They left, and her answer is on file. Tell them.
     *
     * The rule (owner, 2026-08-16): *"If I send a chat message to Cadence and I leave the screen:
     * Cadence always keeps running / working on the prompt. Cadence always sends a notification
     * when done. This is true regardless of phase or where I'm chatting."* The first half has been
     * true since #195. The second half has never been true anywhere except the first-plan build,
     * so leaving a slow turn meant coming back to check by hand — the exact behaviour the app is
     * supposed to make unnecessary.
     *
     * TWO signals, because one of them is not enough:
     *  - `clientAlive === false` — the socket went away mid-turn. True, but LATE: iOS does not
     *    kill a connection the instant it suspends a webview, so a reply finishing inside that
     *    grace period is written to a socket nobody is reading and this stays true.
     *  - `armed` — the client said "I'm going to background" while it still could (0035). This is
     *    the only signal that is correct at the moment it matters, because leaving is a fact only
     *    the client can observe.
     * Someone still watching triggers neither, and gets nothing — they can already see it.
     * Capacitor shows foreground banners by default, so "notify always" would banner over an
     * active chat; these two gates are what make "always" mean "always when you actually left".
     *
     * Awaited, like everything else after the stream: a promise left running past the handler is
     * a promise this platform may never finish (#195).
     */
    if ((armed || !clientAlive) && content.trim()) {
      await sendPlanReadyPush(
        userId,
        'coach_reply',
        `${sessionIdParam}:${responseId ?? Date.now()}`,
        'Cadence replied',
        firstLine(content),
      );
    }

    // Dev X-ray + durable log of the coach turn (responseId + drop flag aid diagnostics
    // and a future live re-attach via the v2 Responses API stream-reconnect).
    updateTrace(userId, { coach: { user: message, reply: content, model, promptTokens, completionTokens } });
    await logAi(userId, {
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
    // the user's explicit yes to the coach's offer.
    //
    // Awaited for the same reason the reply is (above): this is where what someone told you
    // becomes something you remember, and a promise left running past the handler is a promise
    // the platform may never finish. It costs nobody any wait — the response is already ended —
    // only invocation time, which is the correct thing to spend to keep "never make you repeat
    // yourself" true.
    await captureWindow(userId, req.params.id as string, message)
      .then(async (window) => {
        await Promise.allSettled([
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
            .catch((e) => console.error('[capture_extract]', e)),
          runDetourCapture(userId, window)
            .then((o) => {
              if (o.ran) console.log('[capture_detour]', o.reason);
            })
            .catch((e) => console.error('[capture_detour]', e)),
        ]);
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
 * POST /coach/sessions/:id/notify-on-reply — "I'm leaving; tell me when she's done."
 *
 * Sent by the client the instant iOS backgrounds it with a turn in flight, inside the short window
 * where JavaScript still runs. It exists because the server cannot see this for itself: a
 * suspended webview's socket can stay open, so the reply lands on a connection nobody is reading
 * and the turn looks watched. Leaving is a fact only the client has, so the client states it.
 *
 * Ownership checked against `cadence.conversations`, like Stop — a session id is the only thing
 * standing between one user and another's turn, and here it would aim a notification.
 *
 * Only arms while something is actually generating. A thread armed with no turn in flight is a
 * ping with nothing to announce, and the clearing path (which runs when a reply lands) would never
 * come to disarm it.
 */
router.post('/sessions/:id/notify-on-reply', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const sessionId = req.params.id as string;
  try {
    const conv = await getConversationByAiSession(sessionId);
    if (!conv || conv.user_id !== userId) return void res.status(404).json({ error: 'No such session' });
    if (!conv.in_flight_response_id) return void res.json({ armed: false, reason: 'nothing-in-flight' });
    await setNotifyOnReply(sessionId, true);
    res.json({ armed: true });
  } catch (err) {
    // Soft-fail: this is the notification, never the reply. The dead-socket path still covers the
    // common case, and the client has already backgrounded — there is nobody to show an error to.
    console.error('[POST /coach/sessions/:id/notify-on-reply]', err);
    res.status(200).json({ armed: false });
  }
});

/**
 * POST /coach/sessions/:id/stop — end the in-flight reply.
 *
 * The client aborts its own read the moment Stop is pressed; this is what stops the GENERATION.
 * Without it the reply ran to completion upstream regardless — billed in full, and reappearing
 * whole the next time the conversation was restored, contradicting what the user saw.
 *
 * Ownership is checked against `cadence.conversations` rather than trusted from the URL: a session
 * id is the only thing standing between one user and another's in-flight turn.
 */
router.post('/sessions/:id/stop', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const sessionId = req.params.id as string;
  try {
    const conv = await getConversationByAiSession(sessionId);
    if (!conv || conv.user_id !== userId) {
      res.status(404).json({ error: 'No such session' });
      return;
    }
    // Cancel the response THIS turn is generating (recorded by the relay above). Falling back to
    // the session's provider_metadata would be worse than nothing here: Cadence streams
    // in-process, so that field holds an older turn's id, and cancelling it would report success
    // while the live reply carried on.
    if (!conv.in_flight_response_id) {
      res.json({ cancelled: false, reason: 'nothing-in-flight' });
      return;
    }
    res.json(await cancelCoachTurn(userId, sessionId, conv.in_flight_response_id));
  } catch (err) {
    const aim = AimError.fromUnknown(err);
    // Soft-fail: the client has already stopped listening and handed the composer back, so a
    // failure here costs a wasted generation, not a broken screen.
    console.error('[POST /coach/sessions/:id/stop]', aim.kind, aim.message);
    res.status(200).json({ cancelled: false, reason: aim.kind });
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
