/**
 * AI Manager — openChatSession
 * ============================
 * Split from chat-session-lifecycle.ts (2026-08-04); behaviour identical. The lifecycle module
 * re-exports everything here, so every existing import path still works.
 */
import { getProcessingJobBySlug, getProcessingJob, updateProcessingJob } from '../models/processing-jobs.ts';
import { getWorkflow, getWorkflowBySlug } from '../models/workflows.ts';
import { upsertCallingApplication } from '../models/calling-applications.ts';
import { getAiProfileWithKeys, hydrateAiProfileProviderKeys } from '../models/ai-profiles.ts';
import { DevsAiClient } from '../integrations/devs-ai/client.ts';
import type { ExpectedSchemaInput } from '../services/expected-schema-to-json-schema.ts';
import { createLlmClientForProvider, createLlmClientForUser } from '../integrations/client-factory.ts';
import { getUserCredential } from '../models/user-provider-credentials.ts';
import { getAuthContext, effectiveUserId } from '../db/tenant.ts';
import { createChatSession as dbCreateSession, createChatMessage } from '../models/chat-sessions.ts';
import { errorMessage } from '../lib/error-message.ts';
import type { AiProfileRow, FormattingRule, ProcessingJobRow, ProviderRow, WorkflowRow } from '../types.ts';

export interface OpenChatSessionOptions {
  callingApplication?: string;
  userId: string;
  systemPrompt?: string | null;
  workflowSlug?: string | null;
  workflowId?: string | null;
}

export interface OpenChatSessionResult {
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

export interface JobConfig {
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
