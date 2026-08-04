/**
 * AI Manager — resumeChatSession
 * ==============================
 * Split from chat-session-lifecycle.ts (2026-08-04); behaviour identical. The lifecycle module
 * re-exports everything here, so every existing import path still works.
 */
import { getProcessingJob } from '../models/processing-jobs.ts';
import { getWorkflow } from '../models/workflows.ts';
import { DevsAiClient } from '../integrations/devs-ai/client.ts';
import { DevsAiV2Client } from '../integrations/devs-ai-v2/client.ts';
import { getAuthContext, effectiveUserId } from '../db/tenant.ts';
import {
  getChatSession as dbGetSession,
  getChatSessionByExternalChatId as dbGetSessionByExternalChatId,
  updateChatSession as dbUpdateSession,
  reactivateChatSession as dbReactivateSession,
  listChatMessages,
} from '../models/chat-sessions.ts';
import { errorMessage } from '../lib/error-message.ts';
import type { ChatMessageRow } from '../types.ts';
import { getCompletedWorkflowSteps, getSessionProviderWithKey, resolveSessionClient } from './chat-session-client.ts';
import type { JobConfig, OpenChatSessionResult } from './chat-session-open.ts';

export interface ResumeChatSessionOptions {
  sessionId?: string | null;
  externalChatId?: string | null;
  /* If the provider remote chat is gone, drop external_chat_id and continue
     with local-history replay instead of throwing. Off by default. */
  fallbackToLocal?: boolean;
}

export interface ResumeChatSessionResult extends OpenChatSessionResult {
  /* step_keys already completed in this session (for mid-workflow resume) */
  completedSteps: string[];
  /* accumulated workflow variable pipeline state */
  workflowVariables: Record<string, unknown>;
  /* locally stored conversation history to restore the UI */
  messages: ChatMessageRow[];
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
