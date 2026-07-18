/**
 * AI Manager — Chat Messaging
 * ============================
 * Send messages on an open chat session (free-form / workflow step / rule set),
 * submit tool outputs, and manage Devs.ai v2 stream metadata / cancel / reconnect.
 */

import { getProcessingJob } from '../models/processing-jobs.ts';
import { getWorkflowStepByKey } from '../models/workflows.ts';
import { DevsAiClient } from '../integrations/devs-ai/client.ts';
import { DevsAiV2Client } from '../integrations/devs-ai-v2/client.ts';
import type { ExpectedSchemaInput } from '../services/expected-schema-to-json-schema.ts';
import { DiagnosticSession, shouldRunDiagnostics } from '../services/ai-diagnostics.ts';
import { buildProviderChatOptions } from '../services/ai-profile-runtime-options.ts';
import { getAuthContext, effectiveUserId } from '../db/tenant.ts';
import { resolveAttachments, resolveAttachmentsAsText } from '../services/attachment-resolver.ts';
import { resolveProfileToolDefinitions } from './tool-fulfillment.ts';
import { resolveTimeoutMs, interpolateTemplate } from './job-execution.ts';
import {
  getSessionProviderWithKey,
  resolveSessionClient,
  getCompletedWorkflowSteps,
} from './chat-session-lifecycle.ts';
import { maybeCompactSession, buildCompactedHistory, getSummarizerConfig } from '../services/session-compaction.ts';
import {
  getChatSession as dbGetSession,
  updateChatSession as dbUpdateSession,
  createChatMessage,
  listChatMessages,
} from '../models/chat-sessions.ts';
import type { Attachment, ChatMessage, FormattingRule, ProcessingJobRow, WorkflowStepConfig } from '../types.ts';

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
  systemPrompt?: string | null;
  promptTemplate?: string;
  formattingRules?: FormattingRule[];
  expectedResponseFormat?: string | null;
  expectedSchema?: ExpectedSchemaInput | null;
  applyFormattingRules?: boolean;
  advanced?: Record<string, unknown>;
  ruleSets?: RuleSetConfig[];
}

interface RuleSetConfig {
  key: string;
  name: string;
  description?: string | null;
  promptTemplate?: string;
  formattingRules?: FormattingRule[];
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

  const providerType = session.provider_type;
  const timeoutMs = options.timeoutMs || (await resolveTimeoutMs({}, provider));
  const attachments: Attachment[] = options.attachments || [];

  let resolvedMessage = message;
  let workflowStepId: string | null = null;
  let stepFormattingRules: FormattingRule[] | null = null;
  let stepOutputMappings: Record<string, string> | null = null;
  let ruleSetKey: string | null = null;
  let resolvedJob: ProcessingJobRow | null = null;

  if (options.stepKey && session.workflow_id) {
    /* ── Mode 2: Workflow step invocation ── */
    const step = await getWorkflowStepByKey(session.workflow_id, options.stepKey);
    if (!step) throw new Error(`Workflow step "${options.stepKey}" not found`);

    const job = step.processing_job;
    if (!job) throw new Error(`Workflow step "${options.stepKey}" has no linked processing job`);

    const template: string | undefined = (job.config as JobConfig | undefined)?.promptTemplate;
    if (!template) throw new Error(`Processing job "${job.name}" has no prompt template configured`);

    if (step.depends_on && step.depends_on.length > 0) {
      const completedSteps = await getCompletedWorkflowSteps(sessionId, session.workflow_id);
      const unmet = step.depends_on.filter((dep: string) => !completedSteps.has(dep));
      if (unmet.length > 0) {
        throw new Error(`Step "${options.stepKey}" depends on incomplete steps: ${unmet.join(', ')}`);
      }
    }

    const stepConfig = (step.config || {}) as WorkflowStepConfig;
    const inputMappings = stepConfig.inputMappings || {};
    const accumulated = (session.workflow_variables || {}) as Record<string, unknown>;

    const mergedVars: Record<string, unknown> = {};
    for (const [jobVar, workflowVar] of Object.entries(inputMappings)) {
      if (accumulated[workflowVar] !== undefined) {
        mergedVars[jobVar] = accumulated[workflowVar];
      }
    }
    Object.assign(mergedVars, options.variables || {});

    resolvedMessage = interpolateTemplate(template, mergedVars);
    workflowStepId = step.id;
    stepFormattingRules = (job.config as JobConfig | undefined)?.formattingRules ?? null;
    stepOutputMappings =
      stepConfig.outputMappings && Object.keys(stepConfig.outputMappings).length > 0 ? stepConfig.outputMappings : null;
    resolvedJob = job;
  } else if (options.ruleSetKey) {
    /* ── Mode 3: Rule set invocation ── */
    const job = session.processing_job_id ? await getProcessingJob(session.processing_job_id) : null;
    if (!job) {
      throw new Error(
        'ruleSetKey requires the chat session to be opened with a processing job (use jobSlug or jobId when opening the session).',
      );
    }

    const ruleSets: RuleSetConfig[] | undefined = (job.config as JobConfig | undefined)?.ruleSets;
    if (!Array.isArray(ruleSets) || ruleSets.length === 0) {
      throw new Error(`Processing job "${job.name}" has no rule sets configured.`);
    }

    const ruleSet = ruleSets.find((rs) => rs.key === options.ruleSetKey);
    if (!ruleSet) {
      throw new Error(
        `Rule set "${options.ruleSetKey}" not found in job "${job.name}". Available: ${ruleSets.map((rs) => rs.key).join(', ')}`,
      );
    }

    if (!ruleSet.promptTemplate?.trim()) {
      throw new Error(`Rule set "${options.ruleSetKey}" has no prompt template configured.`);
    }

    resolvedMessage = interpolateTemplate(ruleSet.promptTemplate, options.variables || {});
    ruleSetKey = ruleSet.key;
    stepFormattingRules = ruleSet.formattingRules || null;
    resolvedJob = job;
  } else if (session.processing_job_id) {
    /* ── Mode 1 (free-form): load job for diagnostics if session is linked ── */
    try {
      resolvedJob = await getProcessingJob(session.processing_job_id);
    } catch {
      /* non-fatal — diagnostics just won't fire */
    }
  }

  if (!resolvedMessage) {
    throw new Error('No message content resolved — provide a message, stepKey, or ruleSetKey');
  }

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

  let sseResponse: globalThis.Response;
  if (diagnosticSession) diagnosticSession.startLlmTimer();

  if (providerType === 'devs-ai' && session.external_chat_id) {
    let prompt: string | unknown[];
    const textContent =
      session.message_count === 0 && session.system_prompt
        ? `${session.system_prompt}\n\n---\n\n${resolvedMessage}`
        : resolvedMessage;

    if (attachments.length > 0) {
      const fileRefs = await resolveAttachments(session.external_chat_id, attachments, client as DevsAiClient);
      prompt = [{ type: 'text', text: textContent }, ...fileRefs];
    } else {
      prompt = textContent;
    }

    sseResponse = await (client as DevsAiClient).messageChatSession(session.external_chat_id, prompt, {
      timeoutMs,
      tools: await resolveProfileToolDefinitions(refreshedSession.ai_profile),
    });
  } else if (typeof client.chatCompletionStream === 'function') {
    let enrichedContent = resolvedMessage;
    if (attachments.length > 0) {
      const textFiles = await resolveAttachmentsAsText(attachments);
      if (textFiles.length > 0) {
        const fileBlock = textFiles.map((f) => `--- ${f.fileName} ---\n${f.content}`).join('\n\n');
        enrichedContent = `${fileBlock}\n\n---\n\n${enrichedContent}`;
      }
    }
    const historyRaw = await listChatMessages(sessionId);
    const historyMessages = buildCompactedHistory(refreshedSession, historyRaw, getSummarizerConfig(refreshedSession));
    const chatMessages: ChatMessage[] = historyMessages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));
    if (enrichedContent !== resolvedMessage && chatMessages.length > 0) {
      const lastMsg = chatMessages[chatMessages.length - 1];
      if (lastMsg) lastMsg.content = enrichedContent;
    }
    const chatOptions = buildProviderChatOptions(provider.type, profile?.runtime_options || {}, {
      previousResponseId: (
        refreshedSession.provider_metadata as {
          previous_response_id?: string;
        } | null
      )?.previous_response_id,
      conversationId: (
        refreshedSession.provider_metadata as {
          conversation_id?: string;
        } | null
      )?.conversation_id,
      expectedSchema:
        providerType === 'devs-ai-v2' ? (resolvedJob?.config as JobConfig | undefined)?.expectedSchema : undefined,
    });
    const profileTools = await resolveProfileToolDefinitions(refreshedSession.ai_profile);
    const mergedTools = [
      ...(Array.isArray(chatOptions.tools) ? (chatOptions.tools as unknown[]) : []),
      ...(Array.isArray(profileTools) ? profileTools : []),
    ];
    const modelId = String(profile?.external_ai_id || '').trim();
    sseResponse = await client.chatCompletionStream(modelId, chatMessages, {
      ...chatOptions,
      ...(mergedTools.length > 0 ? { tools: mergedTools } : {}),
      timeoutMs,
    });
  } else {
    throw new Error(`Unsupported provider type "${providerType}" for chat streaming`);
  }

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
  const v2Outputs = outputs.map((o) => ({
    tool_call_id: o.toolCallId,
    output: o.output,
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
 */
export async function cancelV2ChatResponse(sessionId: string): Promise<{ cancelled: boolean; responseId: string }> {
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
  const responseId = meta.previous_response_id;
  if (!responseId) throw new Error('No v2 response id in provider_metadata to cancel');

  const client = (await resolveSessionClient(session, provider)) as DevsAiV2Client;
  await client.cancelResponse(responseId);

  console.info('[ai-manager] cancelled v2 response', { sessionId, responseId });
  return { cancelled: true, responseId };
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
