/**
 * AI Manager — Chat Messaging
 * ============================
 * Send messages on an open chat session (free-form / workflow step / rule set),
 * submit tool outputs, and manage Devs.ai v2 stream metadata / cancel / reconnect.
 */

import { DevsAiClient } from '../integrations/devs-ai/client.ts';
import { DevsAiV2Client } from '../integrations/devs-ai-v2/client.ts';
import { DiagnosticSession, shouldRunDiagnostics } from '../services/ai-diagnostics.ts';
import { getAuthContext, effectiveUserId } from '../db/tenant.ts';
import { resolveTimeoutMs } from './job-execution-utils.ts';
import { getSessionProviderWithKey, resolveSessionClient } from './chat-session-lifecycle.ts';
import { maybeCompactSession } from '../services/session-compaction.ts';
import { v2ThreadingEnabled } from '../services/ai-profile-runtime-options.ts';
import { updateV2ProviderMetadata } from './v2-metadata.ts';
import { refreshSessionSystemPrompt } from '../services/session-persona-refresh.ts';
import { getChatSession as dbGetSession, createChatMessage } from '../models/chat-sessions.ts';
import type { Attachment, FormattingRule } from '../types.ts';
import { resolveChatInvocation } from './chat-messaging-resolve.ts';
import { openChatSendStream } from './chat-messaging-stream.ts';
import { resolveProfileToolDefinitions } from './tool-fulfillment.ts';
import { buildSessionChatMessages } from './chat-history.ts';

interface SendChatMessageOptions {
  attachments?: Attachment[];
  stepKey?: string;
  ruleSetKey?: string;
  variables?: Record<string, unknown>;
  timeoutMs?: number;
  /** Caller-supplied tool definitions (see openChatSendStream) — the caller fulfills them. */
  extraTools?: unknown[];
  /**
   * https URLs (short-lived signed Storage URLs) attached as REAL vision content parts on this
   * turn's message — the same shape job execution already sends (job-execution.ts `images`,
   * request-builder.ts:105-111). Distinct from `attachments` above: those are flattened to text
   * (OpenAI-style) or uploaded as file refs (devs-ai v1) — neither puts pixels in front of the
   * model. In-process chat (Cadence's coach) is the first caller; see openChatSendStream.
   */
  images?: string[];
}

interface SendChatMessageResult {
  response: globalThis.Response;
  userMessageId: string;
  sessionId: string;
  workflowStepId: string | null;
  ruleSetKey: string | null;
  stepKey: string | null;
  resolvedMessage: string;
  stepFormattingRules: FormattingRule[] | null;
  stepOutputMappings: Record<string, string> | null;
  diagnosticSession: DiagnosticSession | null;
  expectedResponseFormat: string | null;
}

interface JobConfig {
  expectedResponseFormat?: string | null;
  advanced?: Record<string, unknown>;
}

/**
 * Send a message to an existing chat session and return the raw SSE Response
 * for the route handler to pipe through to the client.
 * Also records the user message immediately and stores the assistant reply
 * after the stream completes.
 *
 * Three invocation modes (mutually exclusive):
 *   1. Free-form:     { message }
 *   2. Workflow step: { stepKey, variables }   — requires session.workflow_id
 *   3. Rule set:      { ruleSetKey, variables } — uses session's linked processing job
 */
export async function sendChatMessage(
  sessionId: string,
  message: string | null,
  options: SendChatMessageOptions = {},
): Promise<SendChatMessageResult> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);
  if (session.status !== 'active') throw new Error(`Chat session ${sessionId} is ${session.status}`);

  const profile = session.ai_profile;
  if (!profile?.provider) throw new Error('Chat session AI profile has no provider');
  const provider = await getSessionProviderWithKey(session);

  const ctx = getAuthContext();
  const authUserId = effectiveUserId(ctx);

  if (session.uses_user_credentials && !authUserId) {
    throw new Error(
      'This session uses personal credentials. Provide user identity via JWT or X-Forwarded-User-Id header.',
    );
  }

  const client = await resolveSessionClient(session, provider);

  const providerType = session.provider_type ?? provider.type;
  const timeoutMs = options.timeoutMs || (await resolveTimeoutMs({}, provider));
  const attachments: Attachment[] = options.attachments || [];
  const images: string[] = options.images || [];

  const { resolvedMessage, workflowStepId, stepFormattingRules, stepOutputMappings, ruleSetKey, resolvedJob } =
    await resolveChatInvocation(session, sessionId, message, options);

  /* ── Set up diagnostics ──────────────────────────────────── */
  let diagnosticSession: DiagnosticSession | null = null;
  if (resolvedJob) {
    const advancedConfig: Record<string, unknown> =
      (resolvedJob.config as Record<string, Record<string, unknown>> | undefined)?.advanced || {};
    const diagCheck = shouldRunDiagnostics(advancedConfig);
    if (diagCheck.enabled && diagCheck.persist) {
      diagnosticSession = new DiagnosticSession(
        resolvedJob.id,
        session.calling_application || 'unknown',
        true,
        resolvedJob.workspace_id || null,
        sessionId,
      );
      diagnosticSession.logRequestPayload({
        chatSessionId: sessionId,
        mode: options.ruleSetKey ? 'rule-set' : options.stepKey ? 'workflow-step' : 'free-form',
        ruleSetKey: ruleSetKey || null,
        stepKey: options.stepKey || null,
        variables: options.variables || {},
        jobSlug: resolvedJob.slug,
        jobName: resolvedJob.name,
        providerType,
      });
    }
  }

  const userMsg = await createChatMessage({
    chat_session_id: sessionId,
    role: 'user',
    content: resolvedMessage,
    workflow_step_id: workflowStepId,
    rule_set_key: ruleSetKey,
  });

  /* The job may have been re-prompted since this session opened; catch it up before anything
     reads the history. Ordered BEFORE compaction so the summarizer sees the current instructions
     and the token estimate reflects them. `resolvedJob` was already fetched above. */
  await refreshSessionSystemPrompt(session, resolvedJob);

  /* Session compaction: summarize older turns when over token threshold. STATELESS providers
     only — with threading on, the provider's own ThreadWorkflow holds and budgets the history
     (org contextBudgetPercentages), and compacting our local copy would just spend summarizer
     tokens shrinking a transcript that no longer feeds requests. The local rows stay the audit
     trail either way, and remain the fallback if the thread expires. */
  if (!v2ThreadingEnabled(session.provider_type ?? '', session.ai_profile?.runtime_options || {})) {
    await maybeCompactSession(session, session.calling_application || 'unknown');
  }
  const refreshedSession = (await dbGetSession(sessionId)) || session;

  if (diagnosticSession) diagnosticSession.startLlmTimer();

  const sseResponse = await openChatSendStream({
    sessionId,
    session,
    refreshedSession,
    client,
    provider,
    profile,
    providerType,
    resolvedMessage,
    resolvedJob,
    attachments,
    images,
    timeoutMs,
    extraTools: options.extraTools,
  });

  const expectedResponseFormat: string | null =
    (resolvedJob?.config as JobConfig | undefined)?.expectedResponseFormat ?? null;

  return {
    response: sseResponse,
    userMessageId: userMsg.id,
    sessionId,
    workflowStepId,
    ruleSetKey,
    stepKey: options.stepKey || null,
    resolvedMessage,
    stepFormattingRules,
    stepOutputMappings,
    diagnosticSession,
    expectedResponseFormat,
  };
}

/**
 * Submit tool outputs back to a Devs.ai chat session.
 * Used when the AI requests user input or OAuth authorization via tool.call events.
 */
export async function submitChatToolOutputs(
  sessionId: string,
  systemMessageId: string,
  outputs: Array<{ toolCallId: string; output: string }>,
): Promise<{ response: globalThis.Response; sessionId: string }> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);
  if (session.status !== 'active') throw new Error(`Chat session ${sessionId} is ${session.status}`);

  const profile = session.ai_profile;
  if (!profile?.provider) throw new Error('Chat session AI profile has no provider');
  const provider = await getSessionProviderWithKey(session);

  if (provider.type === 'devs-ai-v2') {
    const meta = (session.provider_metadata || {}) as {
      previous_response_id?: string;
    };
    const responseId = meta.previous_response_id;
    if (!responseId) throw new Error('v2 session has no previous_response_id for tool resume');
    return submitV2ToolOutputs(sessionId, responseId, outputs);
  }

  if (!session.external_chat_id) throw new Error('Session has no external chat id (tool outputs require Devs.ai)');

  const client = await resolveSessionClient(session, provider);

  const timeoutMs = await resolveTimeoutMs({}, provider);
  const sseResponse = await (client as DevsAiClient).submitToolOutputs(
    session.external_chat_id,
    systemMessageId,
    outputs,
    { timeoutMs },
  );

  return { response: sseResponse, sessionId };
}

export interface SubmitV2ToolOutputsOptions {
  /**
   * Tools the CALLER declared for this turn, carried onto the continuation.
   *
   * `sendChatMessage` has always taken `extraTools`, and this did not — so a caller whose tools
   * come from code rather than from the profile got them on round one and **nothing on round two.**
   * Measured on the cadence-coach profile: `resolveProfileToolDefinitions` returns `undefined`, so
   * every continuation was declared with an empty toolbox (#230).
   */
  extraTools?: unknown[];
  /**
   * What the model ASKED, for each output. Required to build a self-contained continuation: an
   * unthreaded `function_call_output` needs its `function_call` beside it or it is an answer to a
   * question the request never contains.
   *
   * Callers should pass the whole turn's exchange, not just the newest round — round three has to
   * be able to see what round one asked and learned.
   */
  calls?: Array<{ toolCallId: string; name: string; arguments?: string | Record<string, unknown> }>;
  /**
   * Everything the assistant has already SAID this turn, across rounds — carried into the rebuilt
   * history as an ordinary assistant message so the continuation reads its own words and
   * continues them.
   *
   * The missing half of #232, found 2026-08-31: the self-contained rebuild carried the history
   * and the tool exchange but never the assistant's mid-turn prose (it is not persisted until the
   * turn ends), so every continuation was a FRESH generation of the same prompt — it re-answered
   * from scratch, re-decided, sometimes re-called the same tool, and four stitched drafts of one
   * answer reached a phone as one paragraph. The model cannot continue words it has never seen.
   */
  assistantTextSoFar?: string;
}

/** The dialect wants the model's own JSON string; AI Admin's own tool-call rows carry it parsed. */
function argumentsAsJson(args: string | Record<string, unknown> | undefined): string {
  if (args == null) return '{}';
  return typeof args === 'string' ? args : JSON.stringify(args);
}

/**
 * Submit fulfilled tool results and open the continuation stream.
 *
 * NOT /resume: a v2 response arrives `completed` with its function_call already in the output, so
 * resume targets a terminal response and 409s (live-probed 2026-08-14). The continuation is a NEW
 * streamed response.
 *
 * It is also no longer THREADED. Sending only the results under a `previous_response_id` returned
 * 200 and silently discarded them — rounds 2-4 of a measured turn each billed exactly 12,772
 * input tokens against round 1's 18,979, meaning the provider rebuilt the model input from its own
 * stored thread every time and our results never joined it (#232). So the continuation now carries
 * the conversation from OUR database plus the tool exchange, the same self-contained shape
 * `sendChatMessage` uses and the only one measurably proven to arrive.
 */
export async function submitV2ToolOutputs(
  sessionId: string,
  responseId: string,
  outputs: Array<{ toolCallId: string; output: string }>,
  options: SubmitV2ToolOutputsOptions = {},
): Promise<{ response: globalThis.Response; sessionId: string }> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);
  if (session.status !== 'active') throw new Error(`Chat session ${sessionId} is ${session.status}`);

  const profile = session.ai_profile;
  if (!profile?.provider) throw new Error('Chat session AI profile has no provider');
  const provider = await getSessionProviderWithKey(session);
  if (provider.type !== 'devs-ai-v2') {
    throw new Error(`submitV2ToolOutputs requires devs-ai-v2 provider, got "${provider.type}"`);
  }

  const client = (await resolveSessionClient(session, provider)) as DevsAiV2Client;
  const timeoutMs = await resolveTimeoutMs({}, provider);
  const modelId = String(profile?.external_ai_id || '').trim();
  if (!modelId) throw new Error('submitV2ToolOutputs: session profile has no external_ai_id');
  // Caller-supplied tools win; the profile's tool-jobs remain the default for everyone else.
  const tools = options.extraTools?.length ? options.extraTools : await resolveProfileToolDefinitions(profile);
  const toolOpts = { timeoutMs, ...(tools ? { tools } : {}) };

  const byId = new Map((options.calls ?? []).map((c) => [c.toolCallId, c]));
  const exchange = outputs.map((o) => ({ ...o, name: byId.get(o.toolCallId)?.name ?? '' }));

  if (exchange.every((e) => e.name)) {
    try {
      const messages = await buildSessionChatMessages(sessionId, session);
      // Her own words so far this turn ride as a plain assistant message — the least exotic
      // shape the dialect accepts — so the continuation continues instead of re-answering.
      const said = options.assistantTextSoFar?.trim();
      if (said) messages.push({ role: 'assistant', content: said });
      const sseResponse = await client.continueWithToolResults(
        modelId,
        messages,
        exchange.map((e) => ({ ...e, arguments: argumentsAsJson(byId.get(e.toolCallId)?.arguments) })),
        toolOpts,
      );
      /* Thread-mode anchor: the continuation carries the FULL conversation plus the exchange, so
         its response id names a complete server-side thread — the next threaded turn can hang off
         it without losing the tool round. Harmless with the flag off (recorded, never sent). */
      const contResponseId = sseResponse.headers.get('x-response-id');
      if (sseResponse.ok && contResponseId) {
        await updateV2ProviderMetadata(sessionId, { previous_response_id: contResponseId }).catch(() => {});
      }
      return { response: sseResponse, sessionId };
    } catch (err) {
      /**
       * The self-contained shape cannot be rehearsed before it ships: coach chat is in-process
       * streaming and the encryption key is deliberately absent from dev machines, so the first
       * time this payload meets Devs.ai is in production. If the provider rejects it — an unknown
       * item type, a synthetic `fc_replay_N` id it will not take — the turn must not die. The
       * threaded call below is what shipped for weeks: it loses the tool result, which is bad, but
       * it answers, which is the floor. Loud on purpose; a quiet fallback here would look exactly
       * like the bug it is standing in for.
       */
      console.error('[chat-messaging] self-contained continuation REJECTED, falling back to threading (#232):', err);
    }
  } else {
    console.warn('[chat-messaging] tool continuation without call names — falling back to threading (#232)');
  }

  const sseResponse = await client.continueWithToolOutputs(modelId, responseId, outputs, toolOpts);
  return { response: sseResponse, sessionId };
}

export { updateV2ProviderMetadata } from './v2-metadata.ts';

/**
 * Cancel the in-flight Devs.ai v2 response for a chat session.
 * Only supported when provider_type is devs-ai-v2.
 *
 * `explicitResponseId` is for callers that know the id of the response actually in flight and
 * cannot rely on `provider_metadata`. The metadata fallback is written by the HTTP chat route as
 * it streams; an in-process consumer that reads the stream itself (Cadence's coach relay) never
 * writes it, and cancelling `previous_response_id` there would either fail or — worse — target the
 * PREVIOUS turn.
 */
export async function cancelV2ChatResponse(
  sessionId: string,
  explicitResponseId?: string,
): Promise<{ cancelled: boolean; responseId: string }> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);
  if (session.provider_type !== 'devs-ai-v2') {
    throw new Error(`cancel is only supported for devs-ai-v2 sessions (got "${session.provider_type}")`);
  }

  const profile = session.ai_profile;
  if (!profile?.provider) throw new Error('Chat session AI profile has no provider');
  const provider = await getSessionProviderWithKey(session);

  const meta = (session.provider_metadata || {}) as {
    previous_response_id?: string;
  };
  const responseId = explicitResponseId || meta.previous_response_id;
  if (!responseId) throw new Error('No v2 response id in provider_metadata to cancel');

  const client = (await resolveSessionClient(session, provider)) as DevsAiV2Client;
  await client.cancelResponse(responseId);

  console.info('[ai-manager] cancelled v2 response', { sessionId, responseId });
  return { cancelled: true, responseId };
}

/**
 * Pause the in-flight Devs.ai v2 response for a chat session.
 *
 * Differs from cancel in the way that matters to a user: the response is stoppable AND resumable,
 * so "hold on a second" does not have to mean "throw away what you were saying". Generation halts
 * either way, which is what stops it costing.
 *
 * Only supported when provider_type is devs-ai-v2.
 */
export async function pauseV2ChatResponse(sessionId: string): Promise<{ paused: boolean; responseId: string }> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);
  if (session.provider_type !== 'devs-ai-v2') {
    throw new Error(`pause is only supported for devs-ai-v2 sessions (got "${session.provider_type}")`);
  }

  const profile = session.ai_profile;
  if (!profile?.provider) throw new Error('Chat session AI profile has no provider');
  const provider = await getSessionProviderWithKey(session);

  const meta = (session.provider_metadata || {}) as { previous_response_id?: string };
  const responseId = meta.previous_response_id;
  if (!responseId) throw new Error('No v2 response id in provider_metadata to pause');

  const client = (await resolveSessionClient(session, provider)) as DevsAiV2Client;
  await client.pauseResponse(responseId);

  console.info('[ai-manager] paused v2 response', { sessionId, responseId });
  return { paused: true, responseId };
}

/**
 * Reconnect to a Devs.ai v2 response stream after a disconnect.
 * Uses provider_metadata.last_sequence when lastSequence is not supplied.
 * Only supported when provider_type is devs-ai-v2.
 */
export async function reconnectV2ChatStream(
  sessionId: string,
  options: { lastSequence?: number } = {},
): Promise<{ response: globalThis.Response; sessionId: string }> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);
  if (session.status !== 'active') throw new Error(`Chat session ${sessionId} is ${session.status}`);
  if (session.provider_type !== 'devs-ai-v2') {
    throw new Error(`stream reconnect is only supported for devs-ai-v2 sessions (got "${session.provider_type}")`);
  }

  const profile = session.ai_profile;
  if (!profile?.provider) throw new Error('Chat session AI profile has no provider');
  const provider = await getSessionProviderWithKey(session);

  const meta = (session.provider_metadata || {}) as {
    previous_response_id?: string;
    last_sequence?: number;
  };
  const responseId = meta.previous_response_id;
  if (!responseId) throw new Error('No v2 response id in provider_metadata to reconnect');

  const lastSequence = options.lastSequence != null ? options.lastSequence : Number(meta.last_sequence ?? 0) || 0;

  const client = (await resolveSessionClient(session, provider)) as DevsAiV2Client;
  const timeoutMs = await resolveTimeoutMs({}, provider);
  const sseResponse = await client.reconnectResponseStream(responseId, lastSequence, { timeoutMs });

  console.info('[ai-manager] reconnecting v2 stream', {
    sessionId,
    responseId,
    lastSequence,
  });
  return { response: sseResponse, sessionId };
}
