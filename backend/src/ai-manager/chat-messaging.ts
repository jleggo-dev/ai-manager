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
import {
  getChatSession as dbGetSession,
  updateChatSession as dbUpdateSession,
  createChatMessage,
} from '../models/chat-sessions.ts';
import type { Attachment, FormattingRule } from '../types.ts';
import { resolveChatInvocation } from './chat-messaging-resolve.ts';
import { openChatSendStream } from './chat-messaging-stream.ts';

interface SendChatMessageOptions {
  attachments?: Attachment[];
  stepKey?: string;
  ruleSetKey?: string;
  variables?: Record<string, unknown>;
  timeoutMs?: number;
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

  /* Session compaction: summarize older turns when over token threshold */
  await maybeCompactSession(session, session.calling_application || 'unknown');
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
    timeoutMs,
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

/**
 * Submit tool outputs to a Devs.ai v2 response via POST /responses/{id}/resume.
 */
export async function submitV2ToolOutputs(
  sessionId: string,
  responseId: string,
  outputs: Array<{ toolCallId: string; output: string }>,
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
  // Devs.ai /resume expects camelCase toolOutputs (toolCallId/status/output), not tool_outputs.
  const v2Outputs = outputs.map((o) => ({
    toolCallId: o.toolCallId,
    output: o.output,
    status: 'success' as const,
  }));
  const sseResponse = await client.resumeResponseStream(responseId, v2Outputs, {
    timeoutMs,
  });

  return { response: sseResponse, sessionId };
}

/** Persist v2 threading metadata on a chat session after a completed response. */

/** Persist v2 threading metadata on a chat session after a completed response. */
export async function updateV2ProviderMetadata(
  sessionId: string,
  patch: {
    previous_response_id?: string;
    conversation_id?: string;
    last_sequence?: number;
  },
): Promise<void> {
  const session = await dbGetSession(sessionId);
  if (!session) return;
  const current = (session.provider_metadata || {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...current };
  if (patch.previous_response_id) next.previous_response_id = patch.previous_response_id;
  if (patch.conversation_id) next.conversation_id = patch.conversation_id;
  if (patch.last_sequence != null) next.last_sequence = patch.last_sequence;
  await dbUpdateSession(sessionId, { provider_metadata: next });
}

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
