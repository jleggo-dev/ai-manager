/**
 * AI Manager — Chat Session Lifecycle
 * =====================================
 * Open / resume / close / reset / delete chat sessions, history and files,
 * assistant-message persistence, and compliance remote-chat purge.
 */

import { getProcessingJobBySlug, getProcessingJob, updateProcessingJob } from '../models/processing-jobs.ts';
import { getWorkflow, getWorkflowBySlug } from '../models/workflows.ts';
import { upsertCallingApplication } from '../models/calling-applications.ts';
import { getAiProfileWithKeys, hydrateAiProfileProviderKeys } from '../models/ai-profiles.ts';
import { DevsAiClient } from '../integrations/devs-ai/client.ts';
import { DevsAiV2Client } from '../integrations/devs-ai-v2/client.ts';
import type { ExpectedSchemaInput } from '../services/expected-schema-to-json-schema.ts';
import { createLlmClientForProvider, createLlmClientForUser } from '../integrations/client-factory.ts';
import { getUserCredential } from '../models/user-provider-credentials.ts';
import { getAuthContext, effectiveUserId, tenantFrom } from '../db/tenant.ts';
import {
  createChatSession as dbCreateSession,
  getChatSession as dbGetSession,
  getChatSessionByExternalChatId as dbGetSessionByExternalChatId,
  updateChatSession as dbUpdateSession,
  reactivateChatSession as dbReactivateSession,
  deleteChatSession as dbDeleteSession,
  createChatMessage,
  listChatMessages,
  deleteChatMessages,
  incrementSessionCounters,
} from '../models/chat-sessions.ts';
import { errorMessage } from '../lib/error-message.ts';
import type {
  AiProfileRow,
  ChatMessageRow,
  ChatSessionRow,
  FormattingRule,
  ProcessingJobRow,
  ProviderRow,
  WorkflowRow,
} from '../types.ts';
import { getSessionProviderWithKey, resolveSessionClient, getCompletedWorkflowSteps } from './chat-session-client.ts';

/* Re-export leaf helpers so existing imports from this module stay stable. */
export { getSessionProviderWithKey, resolveSessionClient, getCompletedWorkflowSteps };

interface OpenChatSessionOptions {
  callingApplication?: string;
  userId: string;
  systemPrompt?: string | null;
  workflowSlug?: string | null;
  workflowId?: string | null;
}

interface OpenChatSessionResult {
  sessionId: string;
  externalChatId: string | null;
  providerType: string;
  status: string;
  workflowId: string | null;
  steps: Array<{
    stepKey: string;
    name: string;
    sortOrder?: number;
    isRequired?: boolean;
    dependsOn?: string[];
  }>;
  ruleSets: Array<{
    key: string;
    name: string;
    description: string | null;
  }>;
  aiProfileId: string;
  aiProfileName: string;
}

interface ResumeChatSessionOptions {
  sessionId?: string | null;
  externalChatId?: string | null;
  /* If the provider remote chat is gone, drop external_chat_id and continue
     with local-history replay instead of throwing. Off by default. */
  fallbackToLocal?: boolean;
}

interface ResumeChatSessionResult extends OpenChatSessionResult {
  /* step_keys already completed in this session (for mid-workflow resume) */
  completedSteps: string[];
  /* accumulated workflow variable pipeline state */
  workflowVariables: Record<string, unknown>;
  /* locally stored conversation history to restore the UI */
  messages: ChatMessageRow[];
}

interface RecordMetrics {
  promptTokens?: number | null;
  completionTokens?: number | null;
  durationMs?: number | null;
  firstTokenMs?: number | null;
}

interface JobConfig {
  systemPrompt?: string | null;
  promptTemplate?: string;
  formattingRules?: FormattingRule[];
  expectedResponseFormat?: string | null;
  expectedSchema?: ExpectedSchemaInput | null;
  applyFormattingRules?: boolean;
  advanced?: Record<string, unknown>;
  ruleSets?: Array<{
    key: string;
    name: string;
    description?: string | null;
    promptTemplate?: string;
    formattingRules?: FormattingRule[];
  }>;
}

/**
 * Open a new chat session for a given processing job slug or AI profile ID.
 */
export async function openChatSession(
  jobSlugOrProfileId: string,
  options: OpenChatSessionOptions = { userId: '' },
): Promise<OpenChatSessionResult> {
  const { callingApplication, userId, systemPrompt = null, workflowSlug = null, workflowId = null } = options;
  if (!userId) throw new Error('userId is required for chat sessions');

  let profile: AiProfileRow | null | undefined;
  let jobId: string | null = null;
  let jobConfig: JobConfig | null = null;
  let workflow: WorkflowRow | null = null;
  let resolvedJob: ProcessingJobRow | null = null;

  if (workflowSlug || workflowId) {
    workflow = workflowId ? await getWorkflow(workflowId) : await getWorkflowBySlug(workflowSlug ?? '');
    if (!workflow) throw new Error(`Workflow "${workflowSlug || workflowId}" not found`);
    if (!workflow.is_active) throw new Error('This workflow is not active');
    profile = workflow.ai_profile;
  } else {
    /* Try slug first, then UUID lookup, then fall back to treating it as a profile ID */
    const job =
      (await getProcessingJobBySlug(jobSlugOrProfileId).catch(() => null)) ||
      (await getProcessingJob(jobSlugOrProfileId).catch(() => null));
    if (job) {
      profile = job.ai_profile;
      jobId = job.id;
      jobConfig = (job.config as JobConfig | undefined) ?? null;
      resolvedJob = job;
    } else {
      profile = await getAiProfileWithKeys(jobSlugOrProfileId);
    }
  }

  if (profile) {
    profile = hydrateAiProfileProviderKeys(profile);
  }

  if (!profile?.provider) {
    throw new Error('Could not resolve AI profile with provider');
  }

  const provider: ProviderRow = profile.provider;
  const providerType = provider.type;

  const ctx = getAuthContext();
  const authUserId = effectiveUserId(ctx);

  if (resolvedJob?.requires_user_credentials) {
    if (!authUserId) {
      throw new Error(
        'This job requires personal credentials. Provide user identity via JWT or X-Forwarded-User-Id header.',
      );
    }
    const cred = await getUserCredential(authUserId, provider.id);
    if (!cred) {
      throw new Error(
        'This job requires personal credentials. Store your provider key via POST /api/user-credentials.',
      );
    }
  }

  const usesUserCreds = !!authUserId;
  const client = authUserId ? await createLlmClientForUser(provider, authUserId) : createLlmClientForProvider(provider);

  let externalChatId: string | null = null;
  const isDevsAiAgent =
    providerType === 'devs-ai' &&
    profile.mode === 'chat' &&
    typeof (client as DevsAiClient).createChatSession === 'function';
  if (isDevsAiAgent) {
    const aiId = String(profile.external_ai_id || '').trim();
    if (!aiId) throw new Error('Devs.ai profile has no external_ai_id');
    const chatSession = (await (client as DevsAiClient).createChatSession(aiId)) as Record<string, unknown> | null;
    externalChatId = (chatSession?.id as string) || null;
  }

  // A job-bound chat session uses the JOB's config.systemPrompt as its base system
  // prompt — managed/editable in the job's build rules — and a caller-supplied
  // systemPrompt (e.g. per-user runtime context) is appended to it. A workflow's
  // systemPrompt still takes precedence; callers with no bound job are unaffected.
  const jobSystemPrompt = (jobConfig?.systemPrompt as string | null) ?? null;
  const effectiveSystemPrompt: string | null =
    (workflow?.config?.systemPrompt as string | null) ||
    [jobSystemPrompt, systemPrompt].filter(Boolean).join('\n\n') ||
    null;

  const session = await dbCreateSession({
    ai_profile_id: profile.id,
    processing_job_id: jobId,
    workflow_id: workflow?.id || null,
    user_id: userId,
    calling_application: callingApplication || 'unknown',
    external_chat_id: externalChatId,
    provider_type: providerType,
    status: 'active',
    system_prompt: effectiveSystemPrompt,
    uses_user_credentials: usesUserCreds,
  });

  /* ── Auto-register calling application + tag linked job ── */
  if (callingApplication && callingApplication !== 'unknown' && callingApplication !== 'ai-admin-test') {
    try {
      await upsertCallingApplication(callingApplication, callingApplication);
      console.info(`[ai-manager] Registered calling application: "${callingApplication}"`);
      if (jobId) {
        const linkedJob = await getProcessingJob(jobId);
        if (linkedJob && !linkedJob.calling_application_id) {
          await updateProcessingJob(jobId, {
            calling_application_id: callingApplication,
          });
        }
      }
    } catch (autoRegErr: unknown) {
      console.warn(
        '[ai-manager] openChatSession auto-register calling app failed (non-fatal):',
        errorMessage(autoRegErr),
      );
    }
  }

  if (effectiveSystemPrompt) {
    await createChatMessage({
      chat_session_id: session.id,
      role: 'system',
      content: effectiveSystemPrompt,
    });
  }

  const steps =
    workflow?.steps?.map((s) => ({
      stepKey: s.step_key,
      name: s.name,
      sortOrder: s.sort_order,
      isRequired: s.is_required,
      dependsOn: s.depends_on,
    })) ?? [];

  /* Expose rule sets so the calling app knows which keys are available */
  const configRuleSets = jobConfig?.ruleSets;
  const ruleSets = (Array.isArray(configRuleSets) ? configRuleSets : []).map((rs) => ({
    key: rs.key,
    name: rs.name,
    description: rs.description ?? null,
  }));

  return {
    sessionId: session.id,
    externalChatId,
    providerType,
    status: 'active',
    workflowId: workflow?.id || null,
    steps,
    ruleSets,
    aiProfileId: profile.id,
    aiProfileName: profile.name,
  };
}

/**
 * Resume a previously opened streaming chat session so a calling application
 * can continue a prior conversation. Looks the session up by AI Admin
 * sessionId or by the provider chat id (Devs.ai external_chat_id),
 * reactivates it if it was closed, and returns the restored local history.
 *
 * Streaming chat only — there is no session (and nothing to resume) for
 * one-shot completion jobs.
 *
 * Behavior:
 *   - Devs.ai sessions: validates the remote chat via Devs.ai "get a chat
 *     session" before reactivating; if the remote chat is gone, throws
 *     (or, with fallbackToLocal, drops external_chat_id and replays local
 *     history via chatCompletionStream).
 *   - Gemini / model sessions: reactivates and relies on local history.
 *   - Idempotent: resuming an already-active session is a no-op success.
 */
export async function resumeChatSession(options: ResumeChatSessionOptions): Promise<ResumeChatSessionResult> {
  const { sessionId = null, externalChatId = null, fallbackToLocal = false } = options;
  if (!sessionId && !externalChatId) {
    throw new Error('Provide sessionId or externalChatId to resume a chat session');
  }

  let session = sessionId ? await dbGetSession(sessionId) : null;
  if (!session && externalChatId) session = await dbGetSessionByExternalChatId(externalChatId);
  if (!session) throw new Error('Chat session not found');

  const profile = session.ai_profile;
  if (!profile?.provider) throw new Error('Chat session AI profile has no provider');

  /* Credential parity: sessions opened with personal credentials require a
     user identity (JWT or X-Forwarded-User-Id) to resume. */
  const ctx = getAuthContext();
  const authUserId = effectiveUserId(ctx);
  if (session.uses_user_credentials && !authUserId) {
    throw new Error(
      'This session uses personal credentials. Provide user identity via JWT or X-Forwarded-User-Id header.',
    );
  }

  /* Devs.ai v1: validate the remote chat still exists before reactivating. */
  let remoteValidated = false;
  if (session.provider_type === 'devs-ai' && session.external_chat_id) {
    const provider = await getSessionProviderWithKey(session);
    const client = await resolveSessionClient(session, provider);
    if (typeof (client as DevsAiClient).getChatSession === 'function') {
      try {
        await (client as DevsAiClient).getChatSession(session.external_chat_id);
        remoteValidated = true;
      } catch (err) {
        if (fallbackToLocal) {
          await dbUpdateSession(session.id, { external_chat_id: null });
          session = { ...session, external_chat_id: null };
        } else {
          throw new Error(
            `Remote chat ${session.external_chat_id} is no longer available on the provider: ${errorMessage(err)}`,
            { cause: err },
          );
        }
      }
    }
  }

  /* Devs.ai v2: validate the last response still exists when we have threading metadata. */
  if (session.provider_type === 'devs-ai-v2') {
    const meta = (session.provider_metadata || {}) as {
      previous_response_id?: string;
    };
    if (meta.previous_response_id) {
      const provider = await getSessionProviderWithKey(session);
      const client = (await resolveSessionClient(session, provider)) as DevsAiV2Client;
      try {
        await client.getResponse(meta.previous_response_id);
        remoteValidated = true;
      } catch (err) {
        if (fallbackToLocal) {
          await dbUpdateSession(session.id, { provider_metadata: null });
          session = { ...session, provider_metadata: null };
        } else {
          throw new Error(
            `Remote v2 response ${meta.previous_response_id} is no longer available: ${errorMessage(err)}`,
            { cause: err },
          );
        }
      }
    }
  }

  /* Reactivate if closed (idempotent if already active), then re-hydrate the
     joined row so downstream relations/status are fresh. */
  if (session.status !== 'active') {
    await dbReactivateSession(session.id);
    const fresh = await dbGetSession(session.id);
    if (fresh) session = fresh;
  }

  /* Re-derive workflow steps + completion state for mid-workflow resume. */
  let steps: OpenChatSessionResult['steps'] = [];
  let completedSteps: string[] = [];
  if (session.workflow_id) {
    const workflow = await getWorkflow(session.workflow_id).catch(() => null);
    steps =
      workflow?.steps?.map((s) => ({
        stepKey: s.step_key,
        name: s.name,
        sortOrder: s.sort_order,
        isRequired: s.is_required,
        dependsOn: s.depends_on,
      })) ?? [];
    const done = await getCompletedWorkflowSteps(session.id, session.workflow_id);
    completedSteps = [...done];
  }

  /* Re-expose rule sets from the linked processing job. */
  let ruleSets: OpenChatSessionResult['ruleSets'] = [];
  if (session.processing_job_id) {
    const job = await getProcessingJob(session.processing_job_id).catch(() => null);
    const configRuleSets = (job?.config as JobConfig | undefined)?.ruleSets;
    ruleSets = (Array.isArray(configRuleSets) ? configRuleSets : []).map((rs) => ({
      key: rs.key,
      name: rs.name,
      description: rs.description ?? null,
    }));
  }

  const messages = await listChatMessages(session.id);

  console.info('[ai-manager] resume chat session', {
    sessionId: session.id,
    externalChatId: session.external_chat_id ?? null,
    providerType: session.provider_type ?? null,
    remoteValidated,
    status: session.status,
    messageCount: messages.length,
  });

  return {
    sessionId: session.id,
    externalChatId: session.external_chat_id ?? null,
    providerType: session.provider_type ?? '',
    status: session.status,
    workflowId: session.workflow_id ?? null,
    steps,
    ruleSets,
    aiProfileId: session.ai_profile_id,
    aiProfileName: profile.name,
    completedSteps,
    workflowVariables: (session.workflow_variables as Record<string, unknown>) ?? {},
    messages,
  };
}

/**
 * Record the assistant's completed reply after streaming finishes.
 * Called by the route handler after the SSE stream is fully consumed.
 */
export async function recordAssistantMessage(
  sessionId: string,
  content: string,
  metrics: RecordMetrics = {},
): Promise<ChatMessageRow> {
  const msg = await createChatMessage({
    chat_session_id: sessionId,
    role: 'assistant',
    content,
    prompt_tokens: metrics.promptTokens || null,
    completion_tokens: metrics.completionTokens || null,
    duration_ms: metrics.durationMs || null,
    first_token_ms: metrics.firstTokenMs || null,
  });

  await incrementSessionCounters(sessionId, {
    promptTokens: metrics.promptTokens || 0,
    completionTokens: metrics.completionTokens || 0,
  });

  return msg;
}

/**
 * List all files (user-uploaded and AI-generated) for a chat session.
 * Proxies through to the Devs.ai chat files API.
 */
export async function getChatSessionFiles(sessionId: string): Promise<
  Array<{
    id: string;
    source: string;
    filename: string;
    size: number;
    mimeType: string;
    url: string;
    status: string;
  }>
> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);
  if (!session.external_chat_id) return [];

  const profile = session.ai_profile;
  if (!profile?.provider) return [];
  const provider = await getSessionProviderWithKey(session);
  const client = await resolveSessionClient(session, provider);

  return (client as DevsAiClient).listChatFiles(session.external_chat_id);
}

/**
 * Get chat history — from local DB or from Devs.ai provider.
 */
export async function getChatHistory(
  sessionId: string,
  options: { fromProvider?: boolean } = {},
): Promise<Record<string, unknown>> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);

  if (options.fromProvider && session.provider_type === 'devs-ai' && session.external_chat_id) {
    if (session.ai_profile?.provider) {
      const provider = await getSessionProviderWithKey(session);
      const client = await resolveSessionClient(session, provider);
      if (typeof (client as DevsAiClient).getChatSession === 'function') {
        return (client as DevsAiClient).getChatSession(session.external_chat_id);
      }
    }
  }

  const messages = await listChatMessages(sessionId);
  return { ...session, messages };
}

/**
 * Close a chat session (mark as closed, keep data).
 *
 * The remote Devs.ai chat is intentionally PRESERVED so the session can be
 * resumed later via resumeChatSession. Remote cleanup happens on reset
 * (clears history) and delete (removes the session entirely).
 */
export async function closeChatSession(sessionId: string): Promise<ChatSessionRow> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);
  return dbUpdateSession(sessionId, { status: 'closed' });
}

/**
 * Reset a chat session — clear messages and optionally reset the remote session.
 */
export async function resetChatSession(sessionId: string): Promise<ChatSessionRow> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);

  if (session.provider_type === 'devs-ai' && session.external_chat_id) {
    try {
      if (session.ai_profile?.provider) {
        const provider = await getSessionProviderWithKey(session);
        const client = await resolveSessionClient(session, provider);
        if (typeof (client as DevsAiClient).resetChatSession === 'function') {
          await (client as DevsAiClient).resetChatSession(session.external_chat_id);
        }
      }
    } catch (_err) {
      /* best-effort */
    }
  }

  await deleteChatMessages(sessionId);

  const resetUpdates: Partial<ChatSessionRow> = {
    status: 'active',
    message_count: session.system_prompt ? 1 : 0,
    total_prompt_tokens: 0,
    total_completion_tokens: 0,
    workflow_variables: {},
  };
  if (session.provider_type === 'devs-ai-v2') {
    resetUpdates.provider_metadata = null;
  }

  if (session.system_prompt) {
    await createChatMessage({
      chat_session_id: sessionId,
      role: 'system',
      content: session.system_prompt,
    });
    resetUpdates.message_count = 1;
  }

  return dbUpdateSession(sessionId, resetUpdates);
}

/**
 * Delete a chat session and all its messages.
 */
export async function removeChatSession(sessionId: string): Promise<void> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);

  if (session.provider_type === 'devs-ai' && session.external_chat_id) {
    try {
      if (session.ai_profile?.provider) {
        const provider = await getSessionProviderWithKey(session);
        const client = await resolveSessionClient(session, provider);
        if (typeof (client as DevsAiClient).deleteChatSession === 'function') {
          await (client as DevsAiClient).deleteChatSession(session.external_chat_id);
        }
      }
    } catch (_err) {
      /* best-effort */
    }
  }

  return dbDeleteSession(sessionId);
}

/**
 * Best-effort purge of remote Devs.ai chats for all of a user's sessions in
 * the current workspace. Used by the compliance/user-data deletion paths:
 * because closing a session now PRESERVES the remote chat (so it can be
 * resumed), bulk row deletion would otherwise orphan remote chats on the
 * provider. Never throws — logs and continues. Returns the count purged.
 */
export async function purgeRemoteChatsForUser(userId: string): Promise<number> {
  let rows: Array<
    Pick<
      ChatSessionRow,
      'id' | 'ai_profile_id' | 'provider_type' | 'external_chat_id' | 'uses_user_credentials' | 'user_id'
    >
  > = [];
  try {
    const { data, error } = await tenantFrom('chat_sessions')
      .select('id, ai_profile_id, provider_type, external_chat_id, uses_user_credentials, user_id')
      .eq('user_id', userId)
      .eq('provider_type', 'devs-ai')
      .not('external_chat_id', 'is', null);
    if (error) throw new Error(error.message);
    rows = (data as typeof rows) || [];
  } catch (err) {
    console.warn('[ai-manager] purgeRemoteChatsForUser: failed to list sessions:', errorMessage(err));
    return 0;
  }

  let purged = 0;
  for (const row of rows) {
    try {
      const provider = await getSessionProviderWithKey(row as ChatSessionRow);
      const client = await resolveSessionClient(row as ChatSessionRow, provider);
      if (row.external_chat_id && typeof (client as DevsAiClient).deleteChatSession === 'function') {
        await (client as DevsAiClient).deleteChatSession(row.external_chat_id);
        purged++;
      }
    } catch (err) {
      console.warn(
        `[ai-manager] purgeRemoteChatsForUser: failed to delete remote chat ${row.external_chat_id}:`,
        errorMessage(err),
      );
    }
  }
  return purged;
}
