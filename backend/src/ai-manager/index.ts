/**
 * AI Manager — Public Interface
 * ================================
 * This is the ONLY module that calling applications should import
 * from the AI Manager. All internal concerns (provider resolution,
 * prompt interpolation, LLM calls, formatting) are encapsulated here.
 *
 * Usage by a calling application:
 *
 *   import { executeJob } from '../ai-manager/index.ts';
 *
 *   const result = await executeJob('company-profiling', {
 *     callingApplication: 'company-prospector',
 *     variables: { companyName: 'HubSpot', domain: 'hubspot.com', ... },
 *   });
 *
 *   // result.formatted — the AI response after formatting rules
 *   // result.raw       — the raw AI response before formatting
 *   // result.metadata   — timing, model, usage, finish reason
 */

import {
  getProcessingJobBySlug,
  getProcessingJob,
  updateProcessingJob,
} from "../models/processing-jobs.ts";
import {
  getWorkflow,
  getWorkflowBySlug,
  getWorkflowStepByKey,
  listWorkflowSteps,
} from "../models/workflows.ts";
import { upsertCallingApplication } from "../models/calling-applications.ts";
import {
  getAiProfileWithKeys,
  hydrateAiProfileProviderKeys,
} from "../models/ai-profiles.ts";
import { DevsAiClient } from "../integrations/devs-ai/client.ts";
import { DevsAiV2Client } from "../integrations/devs-ai-v2/client.ts";
import type { ExpectedSchemaInput } from "../services/expected-schema-to-json-schema.ts";
import {
  createLlmClientForProvider,
  createLlmClientForUser,
  type LlmClientInstance,
} from "../integrations/client-factory.ts";
import { getUserCredential } from "../models/user-provider-credentials.ts";
import { applyFormattingRules } from "../services/formatting-rules.ts";
import {
  DiagnosticSession,
  shouldRunDiagnostics,
} from "../services/ai-diagnostics.ts";
import { buildProviderChatOptions } from "../services/ai-profile-runtime-options.ts";
import { getSetting } from "../models/app-settings.ts";
import {
  getAuthContext,
  effectiveUserId,
  requireWorkspaceId,
  tenantFrom,
} from "../db/tenant.ts";
import { getServiceSupabase } from "../db/service-supabase.ts";
import {
  resolveAttachments,
  resolveAttachmentsAsText,
} from "../services/attachment-resolver.ts";
import { resolveJsonPath } from "../lib/json-path.ts";
import {
  buildToolDefinitions,
  buildToolNameMap,
  getToolJobsFromProfile,
  parseToolArguments,
  type PendingToolCall,
  type ToolJobBinding,
} from "../services/tool-jobs.ts";
import {
  maybeCompactSession,
  buildCompactedHistory,
  getSummarizerConfig,
} from "../services/session-compaction.ts";
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
} from "../models/chat-sessions.ts";
import { getConfig } from "../config.ts";
import { errorMessage } from "../lib/error-message.ts";
import type {
  AiManagerResult,
  AiProfileRow,
  Attachment,
  ChatCompletionResponse,
  ChatCompletionUsage,
  ChatMessage,
  ChatMessageRow,
  ChatSessionRow,
  FormattingRule,
  LlmClient,
  ProcessingJobRow,
  ProviderRow,
  WorkflowRow,
  WorkflowStepConfig,
} from "../types.ts";

/* ── Option / Result Interfaces ──────────────────────────────── */

interface ExecuteJobOptions {
  callingApplication?: string;
  variables?: Record<string, unknown>;
  promptOverride?: string | null;
  modelOverride?: string | null;
  enableFailover?: boolean;
}

interface ExecuteJobByIdOptions extends ExecuteJobOptions {
  attachments?: Attachment[];
  _job?: ProcessingJobRow | null;
}

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

interface RecordMetrics {
  promptTokens?: number | null;
  completionTokens?: number | null;
  durationMs?: number | null;
  firstTokenMs?: number | null;
}

interface UploadChunkedOptions {
  jobSlug?: string | null;
  jobId?: string | null;
  callingApplication?: string;
  rows?: Record<string, unknown>[];
  maxChunkBytes?: number;
  namePrefix?: string;
  operationType?: string;
  preDeleteSummary?: Record<string, unknown> | null;
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

interface UploadSummary {
  [key: string]: unknown;
  operationType: string;
  startedAt: string;
  jobSlug: string;
  aiProfileId: string | undefined;
  aiProfileName: string | undefined;
  aiId: string;
  maxBytesPerChunk: number;
  totalMappings: number;
  estimatedBytes: number;
  totalChunks: number;
  uploadedDataSources: Record<string, unknown>[];
  failedChunks: Record<string, unknown>[];
  preDeleteSummary: Record<string, unknown> | null;
  completedAt?: string;
  totalDurationMs?: number;
  status?: string;
}

/* ── Exported Functions ──────────────────────────────────────── */

/**
 * Execute a processing job by slug.
 *
 * This is the primary entry point for calling applications.
 * The AI Manager handles:
 *   - Resolving the AI client from the job's AI profile → provider chain
 *   - Interpolating the prompt template with the provided variables
 *   - Calling the LLM
 *   - Applying configured formatting rules
 *   - (Optional) Logging diagnostics
 */
export async function executeJob(
  jobSlug: string,
  options: ExecuteJobOptions = {},
): Promise<AiManagerResult> {
  const {
    callingApplication = "unknown",
    variables = {},
    promptOverride = null,
    modelOverride = null,
    enableFailover = true,
  } = options;

  /* ── 1. Resolve the processing job ──────────────────────── */
  const job = await getProcessingJobBySlug(jobSlug);
  if (!job) {
    throw new Error(`Processing job "${jobSlug}" not found`);
  }

  return executeJobById(job.id, {
    callingApplication,
    variables,
    promptOverride,
    modelOverride,
    enableFailover,
    _job: job,
  });
}

/**
 * Execute a processing job by ID.
 * Same as executeJob() but uses the job ID directly.
 */
export async function executeJobById(
  jobId: string,
  options: ExecuteJobByIdOptions = {},
): Promise<AiManagerResult> {
  const {
    callingApplication = "unknown",
    variables = {},
    promptOverride = null,
    modelOverride = null,
    enableFailover = true,
    attachments = [],
    _job = null /* Internal: pre-fetched job to avoid double query */,
  } = options;

  const t0 = Date.now();

  /* ── 1. Resolve the processing job ──────────────────────── */
  const job = _job || (await getProcessingJob(jobId));
  if (!job) {
    throw new Error(`Processing job with id "${jobId}" not found`);
  }

  const jobConfig = (job.config ?? {}) as JobConfig;
  const advancedConfig: Record<string, unknown> = jobConfig.advanced ?? {};

  /* ── 1b. Auto-register calling application + tag job ───── */
  if (
    callingApplication &&
    callingApplication !== "unknown" &&
    callingApplication !== "ai-admin-test"
  ) {
    try {
      await upsertCallingApplication(callingApplication, callingApplication);
      console.info(
        `[ai-manager] Registered calling application: "${callingApplication}"`,
      );
      if (!job.calling_application_id) {
        await updateProcessingJob(job.id, {
          calling_application_id: callingApplication,
        });
        job.calling_application_id = callingApplication;
      }
    } catch (autoRegErr: unknown) {
      console.warn(
        "[ai-manager] auto-register calling app failed (non-fatal):",
        errorMessage(autoRegErr),
      );
    }
  }

  /* ── 2. Set up diagnostics ────────────────────────────────
   *  Always create a session so every execution is auditable
   *  (user identity, job id, calling app, status, duration).
   *  Verbose payloads (LLM request/response, timings) are only
   *  recorded when the job explicitly enables full diagnostics.
   */
  const diagCheck = shouldRunDiagnostics(advancedConfig);
  const fullDiagnostics = diagCheck.enabled && diagCheck.persist;
  const diag = new DiagnosticSession(
    job.id,
    callingApplication,
    true,
    job.workspace_id,
  );

  if (fullDiagnostics) {
    diag.logRequestPayload({
      jobSlug: job.slug,
      callingApplication,
      variables,
      promptOverride: promptOverride || false,
      expectedResponseFormat: jobConfig.expectedResponseFormat || null,
    });
  }

  try {
    /* ── 3. Resolve AI client from job → AI profile → provider ── */
    if (fullDiagnostics) diag.startSupabaseTimer();

    const profile = job.ai_profile
      ? hydrateAiProfileProviderKeys(job.ai_profile)
      : job.ai_profile;
    const provider: ProviderRow | undefined = profile?.provider;

    if (!profile || !provider) {
      if (fullDiagnostics)
        diag.endSupabaseTimer(
          "resolve-ai-client",
          false,
          "No AI profile or provider assigned",
        );
      throw new Error("Processing job has no AI profile or provider assigned");
    }

    const client = createLlmClientForProvider(provider);
    const primaryModel = String(
      modelOverride || profile.external_ai_id || "",
    ).trim();
    const providerTypeNorm = String(provider.type || "")
      .trim()
      .toLowerCase();
    const chatOptions = buildProviderChatOptions(
      provider.type,
      profile.runtime_options ?? undefined,
      {
        expectedSchema:
          providerTypeNorm === "devs-ai-v2"
            ? (jobConfig.expectedSchema ?? undefined)
            : undefined,
      },
    );
    const failoverProvider: ProviderRow | undefined =
      profile.failover_provider ?? undefined;
    const failoverAiId = String(profile.failover_external_ai_id || "").trim();
    const hasFailover =
      enableFailover && !modelOverride && failoverProvider && failoverAiId;

    if (fullDiagnostics) diag.endSupabaseTimer("resolve-ai-client", true);

    /* ── 4. Build the final prompt ────────────────────────── */
    let finalPrompt: string;
    if (promptOverride) {
      finalPrompt = promptOverride;
    } else {
      const template: string = jobConfig.promptTemplate || "";
      if (!template.trim()) {
        throw new Error("No prompt template configured for this job");
      }
      finalPrompt = interpolateTemplate(template, variables);
    }

    /* ── 4b. Inject text file attachments into prompt ─────── */
    if (attachments.length > 0) {
      const textFiles = await resolveAttachmentsAsText(attachments);
      if (textFiles.length > 0) {
        const fileBlock = textFiles
          .map((f) => `--- ${f.fileName} ---\n${f.content}`)
          .join("\n\n");
        finalPrompt = `${fileBlock}\n\n---\n\n${finalPrompt}`;
      }
    }

    /* ── 5. Call the LLM ──────────────────────────────────── */
    const effectiveTimeoutMs = await resolveTimeoutMs(advancedConfig, provider);
    if (fullDiagnostics)
      diag.addMetadata("effectiveTimeoutMs", effectiveTimeoutMs);

    if (fullDiagnostics) diag.startLlmTimer();

    const messages: ChatMessage[] = [{ role: "user", content: finalPrompt }];
    let modelUsed = primaryModel;
    let failoverUsed = false;
    let primaryErrorMessage = "";

    let data: ChatCompletionResponse | null = null;
    let rawContent = "";
    let usage: ChatCompletionUsage | null = null;
    let finishReason: string | null = null;

    async function callWithClient(
      llmClient: LlmClientInstance,
      modelId: string,
      msgs: ChatMessage[],
      opts: Record<string, unknown>,
      timeout: number,
    ): Promise<{
      resp: ChatCompletionResponse;
      content: string;
      nextUsage: ChatCompletionUsage | null;
      nextFinishReason: string | null;
    }> {
      const resp = await llmClient.chatCompletion(modelId, msgs, {
        ...opts,
        timeoutMs: timeout,
      });
      const content = resp.choices?.[0]?.message?.content || "";
      return {
        resp,
        content,
        nextUsage: resp.usage ?? null,
        nextFinishReason: resp.choices?.[0]?.finish_reason ?? null,
      };
    }

    const tried: string[] = [];

    try {
      tried.push(primaryModel);
      const out = await callWithClient(
        client,
        primaryModel,
        messages,
        chatOptions,
        effectiveTimeoutMs,
      );
      if (!String(out.content || "").trim()) {
        throw new Error(
          `Model "${primaryModel}" returned empty response content`,
        );
      }
      data = out.resp;
      rawContent = out.content;
      usage = out.nextUsage;
      finishReason = out.nextFinishReason;
    } catch (primaryErr: unknown) {
      primaryErrorMessage = errorMessage(primaryErr);

      let failoverErr: Error | null = null;
      if (hasFailover && failoverProvider) {
        try {
          const failoverClient = createLlmClientForProvider(failoverProvider);
          const failoverRuntimeOpts =
            profile.failover_runtime_options ??
            profile.runtime_options ??
            undefined;
          const failoverChatOpts = buildProviderChatOptions(
            failoverProvider.type,
            failoverRuntimeOpts,
            {
              // The failover must carry the same native schema as the primary — omitting
              // it made a v2 failover answer schema-less on jobs that expect one.
              expectedSchema:
                String(failoverProvider.type || "").trim().toLowerCase() ===
                "devs-ai-v2"
                  ? (jobConfig.expectedSchema ?? undefined)
                  : undefined,
            },
          );
          const failoverTimeoutMs = await resolveTimeoutMs(
            advancedConfig,
            failoverProvider,
          );
          tried.push(failoverAiId);

          const out = await callWithClient(
            failoverClient,
            failoverAiId,
            messages,
            failoverChatOpts,
            failoverTimeoutMs,
          );
          if (!String(out.content || "").trim()) {
            throw new Error(
              `Failover model "${failoverAiId}" returned empty response content`,
              { cause: primaryErr },
            );
          }
          data = out.resp;
          rawContent = out.content;
          usage = out.nextUsage;
          finishReason = out.nextFinishReason;
          modelUsed = failoverAiId;
          failoverUsed = true;
        } catch (err: unknown) {
          failoverErr = err as Error;
        }
      }

      if (!String(rawContent || "").trim()) {
        if (failoverErr) {
          throw new Error(
            `Primary model "${primaryModel}" failed and failover "${failoverAiId}" on provider "${failoverProvider?.name}" also failed: ${failoverErr.message}`,
            { cause: primaryErr },
          );
        } else {
          throw primaryErr;
        }
      }
    }

    const actualProvider =
      failoverUsed && failoverProvider ? failoverProvider : provider;

    if (fullDiagnostics) {
      diag.endLlmTimer(
        {
          model: modelUsed,
          provider: actualProvider.name,
          promptContent: finalPrompt,
          promptLength: finalPrompt.length,
        },
        {
          rawContent,
          rawLength: rawContent.length,
          usage,
          finishReason,
        },
      );
    }

    /* ── 6. Apply formatting rules ────────────────────────── */
    if (fullDiagnostics) diag.startFormattingTimer();

    /* Formatting rules ALWAYS run when defined — even with a native v2 json_schema.
       The Devs.ai v2 shim accepts text.format but does not reliably enforce it for
       every model (observed: gpt-4.1-mini returns ```json fences WITH a strict schema
       accepted), and the failover model may answer without the schema. The rules are
       deterministic app-side transforms (no LLM cost): on clean output they're no-ops;
       on fenced/dirty output they're the backstop that keeps the contract. */
    const formattingRules: FormattingRule[] = jobConfig.formattingRules || [];
    const { formatted, steps } = applyFormattingRules(
      rawContent,
      formattingRules,
    );

    if (fullDiagnostics) diag.endFormattingTimer(formattingRules.length);

    /* ── 7. Build result ──────────────────────────────────── */
    const durationMs = Date.now() - t0;

    const result: AiManagerResult = {
      raw: rawContent,
      formatted,
      formattingSteps: steps,
      messageSent: finalPrompt,
      metadata: {
        durationMs,
        model: data?.model || modelUsed,
        usage,
        finishReason,
        jobSlug: job.slug,
        jobName: job.name,
        aiProfile: profile.name,
        provider: provider.name,
      },
    };

    /* ── 8. Finalise diagnostics (fire-and-forget) ──────────── */
    if (fullDiagnostics) {
      diag.addMetadata("formattedLength", formatted.length);
      diag.addMetadata("rawLength", rawContent.length);
      diag.addMetadata("primaryModel", primaryModel);
      diag.addMetadata("failoverUsed", failoverUsed);
      diag.addMetadata("modelOverride", modelOverride || null);
      diag.addMetadata("enableFailover", enableFailover !== false);
      diag.addMetadata("modelsTried", tried);
      diag.addMetadata("chatOptions", chatOptions);
      if (hasFailover) {
        diag.addMetadata("failoverModel", failoverAiId);
        diag.addMetadata(
          "failoverProviderName",
          failoverProvider?.name || null,
        );
        diag.addMetadata(
          "failoverProviderType",
          failoverProvider?.type || null,
        );
      }
      if (primaryErrorMessage) {
        diag.addMetadata("primaryModelError", primaryErrorMessage);
      }
    }
    diag.complete("success").catch((diagErr: unknown) => {
      console.warn(
        "[AI Manager] Non-blocking diagnostics write failed:",
        errorMessage(diagErr),
      );
    });

    return result;
  } catch (err: unknown) {
    diag.complete("error", errorMessage(err)).catch(() => {});
    throw err;
  }
}

/**
 * Execute a job using env-configured defaults (no processing job lookup).
 * This is a fallback for when no processing job exists yet.
 */
export async function executeRawPrompt(
  prompt: string,
  _options: { callingApplication?: string } = {},
): Promise<AiManagerResult> {
  const cfg = getConfig();
  if (!cfg.devsAi.apiKey) {
    throw new Error("DEVS_AI_API_KEY is not configured");
  }
  const client = new DevsAiClient(cfg.devsAi.baseUrl, cfg.devsAi.apiKey);
  const model = cfg.devsAi.defaultModel;

  const t0 = Date.now();
  const data = await client.chatCompletion(model, [
    { role: "user", content: prompt },
  ]);
  const durationMs = Date.now() - t0;

  return {
    raw: data.choices?.[0]?.message?.content || "",
    formatted: data.choices?.[0]?.message?.content || "",
    formattingSteps: [],
    messageSent: prompt,
    metadata: {
      durationMs,
      model: data.model || model,
      usage: data.usage || null,
      finishReason: data.choices?.[0]?.finish_reason || null,
      jobSlug: null,
      jobName: null,
      aiProfile: "env-default",
      provider: "env-default",
    },
  };
}

/* ================================================================
   Chat Session Management
   ================================================================
   For AI profiles with mode='chat'. Creates stateful conversations
   via Devs.ai Chat Sessions API or client-managed Gemini sessions.
   ================================================================ */

/**
 * Open a new chat session for a given processing job slug or AI profile ID.
 */
export async function openChatSession(
  jobSlugOrProfileId: string,
  options: OpenChatSessionOptions = { userId: "" },
): Promise<OpenChatSessionResult> {
  const {
    callingApplication,
    userId,
    systemPrompt = null,
    workflowSlug = null,
    workflowId = null,
  } = options;
  if (!userId) throw new Error("userId is required for chat sessions");

  let profile: AiProfileRow | null | undefined;
  let jobId: string | null = null;
  let jobConfig: JobConfig | null = null;
  let workflow: WorkflowRow | null = null;
  let resolvedJob: ProcessingJobRow | null = null;

  if (workflowSlug || workflowId) {
    workflow = workflowId
      ? await getWorkflow(workflowId)
      : await getWorkflowBySlug(workflowSlug ?? "");
    if (!workflow)
      throw new Error(`Workflow "${workflowSlug || workflowId}" not found`);
    if (!workflow.is_active) throw new Error("This workflow is not active");
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
    throw new Error("Could not resolve AI profile with provider");
  }

  const provider: ProviderRow = profile.provider;
  const providerType = provider.type;

  const ctx = getAuthContext();
  const authUserId = effectiveUserId(ctx);

  if (resolvedJob?.requires_user_credentials) {
    if (!authUserId) {
      throw new Error(
        "This job requires personal credentials. Provide user identity via JWT or X-Forwarded-User-Id header.",
      );
    }
    const cred = await getUserCredential(authUserId, provider.id);
    if (!cred) {
      throw new Error(
        "This job requires personal credentials. Store your provider key via POST /api/user-credentials.",
      );
    }
  }

  const usesUserCreds = !!authUserId;
  const client = authUserId
    ? await createLlmClientForUser(provider, authUserId)
    : createLlmClientForProvider(provider);

  let externalChatId: string | null = null;
  const isDevsAiAgent =
    providerType === "devs-ai" &&
    profile.mode === "chat" &&
    typeof (client as DevsAiClient).createChatSession === "function";
  if (isDevsAiAgent) {
    const aiId = String(profile.external_ai_id || "").trim();
    if (!aiId) throw new Error("Devs.ai profile has no external_ai_id");
    const chatSession = (await (client as DevsAiClient).createChatSession(
      aiId,
    )) as Record<string, unknown> | null;
    externalChatId = (chatSession?.id as string) || null;
  }

  // A job-bound chat session uses the JOB's config.systemPrompt as its base system
  // prompt — managed/editable in the job's build rules — and a caller-supplied
  // systemPrompt (e.g. per-user runtime context) is appended to it. A workflow's
  // systemPrompt still takes precedence; callers with no bound job are unaffected.
  const jobSystemPrompt = (jobConfig?.systemPrompt as string | null) ?? null;
  const effectiveSystemPrompt: string | null =
    (workflow?.config?.systemPrompt as string | null) ||
    [jobSystemPrompt, systemPrompt].filter(Boolean).join("\n\n") ||
    null;

  const session = await dbCreateSession({
    ai_profile_id: profile.id,
    processing_job_id: jobId,
    workflow_id: workflow?.id || null,
    user_id: userId,
    calling_application: callingApplication || "unknown",
    external_chat_id: externalChatId,
    provider_type: providerType,
    status: "active",
    system_prompt: effectiveSystemPrompt,
    uses_user_credentials: usesUserCreds,
  });

  /* ── Auto-register calling application + tag linked job ── */
  if (
    callingApplication &&
    callingApplication !== "unknown" &&
    callingApplication !== "ai-admin-test"
  ) {
    try {
      await upsertCallingApplication(callingApplication, callingApplication);
      console.info(
        `[ai-manager] Registered calling application: "${callingApplication}"`,
      );
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
        "[ai-manager] openChatSession auto-register calling app failed (non-fatal):",
        errorMessage(autoRegErr),
      );
    }
  }

  if (effectiveSystemPrompt) {
    await createChatMessage({
      chat_session_id: session.id,
      role: "system",
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
  const ruleSets = (Array.isArray(configRuleSets) ? configRuleSets : []).map(
    (rs) => ({
      key: rs.key,
      name: rs.name,
      description: rs.description ?? null,
    }),
  );

  return {
    sessionId: session.id,
    externalChatId,
    providerType,
    status: "active",
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
export async function resumeChatSession(
  options: ResumeChatSessionOptions,
): Promise<ResumeChatSessionResult> {
  const {
    sessionId = null,
    externalChatId = null,
    fallbackToLocal = false,
  } = options;
  if (!sessionId && !externalChatId) {
    throw new Error(
      "Provide sessionId or externalChatId to resume a chat session",
    );
  }

  let session = sessionId ? await dbGetSession(sessionId) : null;
  if (!session && externalChatId)
    session = await dbGetSessionByExternalChatId(externalChatId);
  if (!session) throw new Error("Chat session not found");

  const profile = session.ai_profile;
  if (!profile?.provider)
    throw new Error("Chat session AI profile has no provider");

  /* Credential parity: sessions opened with personal credentials require a
     user identity (JWT or X-Forwarded-User-Id) to resume. */
  const ctx = getAuthContext();
  const authUserId = effectiveUserId(ctx);
  if (session.uses_user_credentials && !authUserId) {
    throw new Error(
      "This session uses personal credentials. Provide user identity via JWT or X-Forwarded-User-Id header.",
    );
  }

  /* Devs.ai v1: validate the remote chat still exists before reactivating. */
  let remoteValidated = false;
  if (session.provider_type === "devs-ai" && session.external_chat_id) {
    const provider = await getSessionProviderWithKey(session);
    const client = await resolveSessionClient(session, provider);
    if (typeof (client as DevsAiClient).getChatSession === "function") {
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
  if (session.provider_type === "devs-ai-v2") {
    const meta = (session.provider_metadata || {}) as {
      previous_response_id?: string;
    };
    if (meta.previous_response_id) {
      const provider = await getSessionProviderWithKey(session);
      const client = (await resolveSessionClient(
        session,
        provider,
      )) as DevsAiV2Client;
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
  if (session.status !== "active") {
    await dbReactivateSession(session.id);
    const fresh = await dbGetSession(session.id);
    if (fresh) session = fresh;
  }

  /* Re-derive workflow steps + completion state for mid-workflow resume. */
  let steps: OpenChatSessionResult["steps"] = [];
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
    const done = await getCompletedWorkflowSteps(
      session.id,
      session.workflow_id,
    );
    completedSteps = [...done];
  }

  /* Re-expose rule sets from the linked processing job. */
  let ruleSets: OpenChatSessionResult["ruleSets"] = [];
  if (session.processing_job_id) {
    const job = await getProcessingJob(session.processing_job_id).catch(
      () => null,
    );
    const configRuleSets = (job?.config as JobConfig | undefined)?.ruleSets;
    ruleSets = (Array.isArray(configRuleSets) ? configRuleSets : []).map(
      (rs) => ({
        key: rs.key,
        name: rs.name,
        description: rs.description ?? null,
      }),
    );
  }

  const messages = await listChatMessages(session.id);

  console.info("[ai-manager] resume chat session", {
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
    providerType: session.provider_type ?? "",
    status: session.status,
    workflowId: session.workflow_id ?? null,
    steps,
    ruleSets,
    aiProfileId: session.ai_profile_id,
    aiProfileName: profile.name,
    completedSteps,
    workflowVariables:
      (session.workflow_variables as Record<string, unknown>) ?? {},
    messages,
  };
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
  if (session.status !== "active")
    throw new Error(`Chat session ${sessionId} is ${session.status}`);

  const profile = session.ai_profile;
  if (!profile?.provider)
    throw new Error("Chat session AI profile has no provider");
  const provider = await getSessionProviderWithKey(session);

  const ctx = getAuthContext();
  const authUserId = effectiveUserId(ctx);

  if (session.uses_user_credentials && !authUserId) {
    throw new Error(
      "This session uses personal credentials. Provide user identity via JWT or X-Forwarded-User-Id header.",
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
    const step = await getWorkflowStepByKey(
      session.workflow_id,
      options.stepKey,
    );
    if (!step) throw new Error(`Workflow step "${options.stepKey}" not found`);

    const job = step.processing_job;
    if (!job)
      throw new Error(
        `Workflow step "${options.stepKey}" has no linked processing job`,
      );

    const template: string | undefined = (job.config as JobConfig | undefined)
      ?.promptTemplate;
    if (!template)
      throw new Error(
        `Processing job "${job.name}" has no prompt template configured`,
      );

    if (step.depends_on && step.depends_on.length > 0) {
      const completedSteps = await getCompletedWorkflowSteps(
        sessionId,
        session.workflow_id,
      );
      const unmet = step.depends_on.filter(
        (dep: string) => !completedSteps.has(dep),
      );
      if (unmet.length > 0) {
        throw new Error(
          `Step "${options.stepKey}" depends on incomplete steps: ${unmet.join(", ")}`,
        );
      }
    }

    const stepConfig = (step.config || {}) as WorkflowStepConfig;
    const inputMappings = stepConfig.inputMappings || {};
    const accumulated = (session.workflow_variables || {}) as Record<
      string,
      unknown
    >;

    const mergedVars: Record<string, unknown> = {};
    for (const [jobVar, workflowVar] of Object.entries(inputMappings)) {
      if (accumulated[workflowVar] !== undefined) {
        mergedVars[jobVar] = accumulated[workflowVar];
      }
    }
    Object.assign(mergedVars, options.variables || {});

    resolvedMessage = interpolateTemplate(template, mergedVars);
    workflowStepId = step.id;
    stepFormattingRules =
      (job.config as JobConfig | undefined)?.formattingRules ?? null;
    stepOutputMappings =
      stepConfig.outputMappings &&
      Object.keys(stepConfig.outputMappings).length > 0
        ? stepConfig.outputMappings
        : null;
    resolvedJob = job;
  } else if (options.ruleSetKey) {
    /* ── Mode 3: Rule set invocation ── */
    const job = session.processing_job_id
      ? await getProcessingJob(session.processing_job_id)
      : null;
    if (!job) {
      throw new Error(
        "ruleSetKey requires the chat session to be opened with a processing job (use jobSlug or jobId when opening the session).",
      );
    }

    const ruleSets: RuleSetConfig[] | undefined = (
      job.config as JobConfig | undefined
    )?.ruleSets;
    if (!Array.isArray(ruleSets) || ruleSets.length === 0) {
      throw new Error(
        `Processing job "${job.name}" has no rule sets configured.`,
      );
    }

    const ruleSet = ruleSets.find((rs) => rs.key === options.ruleSetKey);
    if (!ruleSet) {
      throw new Error(
        `Rule set "${options.ruleSetKey}" not found in job "${job.name}". Available: ${ruleSets.map((rs) => rs.key).join(", ")}`,
      );
    }

    if (!ruleSet.promptTemplate?.trim()) {
      throw new Error(
        `Rule set "${options.ruleSetKey}" has no prompt template configured.`,
      );
    }

    resolvedMessage = interpolateTemplate(
      ruleSet.promptTemplate,
      options.variables || {},
    );
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
    throw new Error(
      "No message content resolved — provide a message, stepKey, or ruleSetKey",
    );
  }

  /* ── Set up diagnostics ──────────────────────────────────── */
  let diagnosticSession: DiagnosticSession | null = null;
  if (resolvedJob) {
    const advancedConfig: Record<string, unknown> =
      (
        resolvedJob.config as
          | Record<string, Record<string, unknown>>
          | undefined
      )?.advanced || {};
    const diagCheck = shouldRunDiagnostics(advancedConfig);
    if (diagCheck.enabled && diagCheck.persist) {
      diagnosticSession = new DiagnosticSession(
        resolvedJob.id,
        session.calling_application || "unknown",
        true,
        resolvedJob.workspace_id || null,
        sessionId,
      );
      diagnosticSession.logRequestPayload({
        chatSessionId: sessionId,
        mode: options.ruleSetKey
          ? "rule-set"
          : options.stepKey
            ? "workflow-step"
            : "free-form",
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
    role: "user",
    content: resolvedMessage,
    workflow_step_id: workflowStepId,
    rule_set_key: ruleSetKey,
  });

  /* Session compaction: summarize older turns when over token threshold */
  await maybeCompactSession(session, session.calling_application || "unknown");
  const refreshedSession = (await dbGetSession(sessionId)) || session;

  let sseResponse: globalThis.Response;
  if (diagnosticSession) diagnosticSession.startLlmTimer();

  if (providerType === "devs-ai" && session.external_chat_id) {
    let prompt: string | unknown[];
    const textContent =
      session.message_count === 0 && session.system_prompt
        ? `${session.system_prompt}\n\n---\n\n${resolvedMessage}`
        : resolvedMessage;

    if (attachments.length > 0) {
      const fileRefs = await resolveAttachments(
        session.external_chat_id,
        attachments,
        client as DevsAiClient,
      );
      prompt = [{ type: "text", text: textContent }, ...fileRefs];
    } else {
      prompt = textContent;
    }

    sseResponse = await (client as DevsAiClient).messageChatSession(
      session.external_chat_id,
      prompt,
      {
        timeoutMs,
        tools: await resolveProfileToolDefinitions(refreshedSession.ai_profile),
      },
    );
  } else if (typeof client.chatCompletionStream === "function") {
    let enrichedContent = resolvedMessage;
    if (attachments.length > 0) {
      const textFiles = await resolveAttachmentsAsText(attachments);
      if (textFiles.length > 0) {
        const fileBlock = textFiles
          .map((f) => `--- ${f.fileName} ---\n${f.content}`)
          .join("\n\n");
        enrichedContent = `${fileBlock}\n\n---\n\n${enrichedContent}`;
      }
    }
    const historyRaw = await listChatMessages(sessionId);
    const historyMessages = buildCompactedHistory(
      refreshedSession,
      historyRaw,
      getSummarizerConfig(refreshedSession),
    );
    const chatMessages: ChatMessage[] = historyMessages.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    }));
    if (enrichedContent !== resolvedMessage && chatMessages.length > 0) {
      const lastMsg = chatMessages[chatMessages.length - 1];
      if (lastMsg) lastMsg.content = enrichedContent;
    }
    const chatOptions = buildProviderChatOptions(
      provider.type,
      profile?.runtime_options || {},
      {
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
          providerType === "devs-ai-v2"
            ? (resolvedJob?.config as JobConfig | undefined)?.expectedSchema
            : undefined,
      },
    );
    const profileTools = await resolveProfileToolDefinitions(
      refreshedSession.ai_profile,
    );
    const mergedTools = [
      ...(Array.isArray(chatOptions.tools)
        ? (chatOptions.tools as unknown[])
        : []),
      ...(Array.isArray(profileTools) ? profileTools : []),
    ];
    const modelId = String(profile?.external_ai_id || "").trim();
    sseResponse = await client.chatCompletionStream(modelId, chatMessages, {
      ...chatOptions,
      ...(mergedTools.length > 0 ? { tools: mergedTools } : {}),
      timeoutMs,
    });
  } else {
    throw new Error(
      `Unsupported provider type "${providerType}" for chat streaming`,
    );
  }

  const expectedResponseFormat: string | null =
    (resolvedJob?.config as JobConfig | undefined)?.expectedResponseFormat ??
    null;

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
  if (session.status !== "active")
    throw new Error(`Chat session ${sessionId} is ${session.status}`);

  const profile = session.ai_profile;
  if (!profile?.provider)
    throw new Error("Chat session AI profile has no provider");
  const provider = await getSessionProviderWithKey(session);

  if (provider.type === "devs-ai-v2") {
    const meta = (session.provider_metadata || {}) as {
      previous_response_id?: string;
    };
    const responseId = meta.previous_response_id;
    if (!responseId)
      throw new Error("v2 session has no previous_response_id for tool resume");
    return submitV2ToolOutputs(sessionId, responseId, outputs);
  }

  if (!session.external_chat_id)
    throw new Error(
      "Session has no external chat id (tool outputs require Devs.ai)",
    );

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
  if (session.status !== "active")
    throw new Error(`Chat session ${sessionId} is ${session.status}`);

  const profile = session.ai_profile;
  if (!profile?.provider)
    throw new Error("Chat session AI profile has no provider");
  const provider = await getSessionProviderWithKey(session);
  if (provider.type !== "devs-ai-v2") {
    throw new Error(
      `submitV2ToolOutputs requires devs-ai-v2 provider, got "${provider.type}"`,
    );
  }

  const client = (await resolveSessionClient(
    session,
    provider,
  )) as DevsAiV2Client;
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
  if (patch.previous_response_id)
    next.previous_response_id = patch.previous_response_id;
  if (patch.conversation_id) next.conversation_id = patch.conversation_id;
  if (patch.last_sequence != null) next.last_sequence = patch.last_sequence;
  await dbUpdateSession(sessionId, { provider_metadata: next });
}

/**
 * Cancel the in-flight Devs.ai v2 response for a chat session.
 * Only supported when provider_type is devs-ai-v2.
 */
export async function cancelV2ChatResponse(
  sessionId: string,
): Promise<{ cancelled: boolean; responseId: string }> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);
  if (session.provider_type !== "devs-ai-v2") {
    throw new Error(
      `cancel is only supported for devs-ai-v2 sessions (got "${session.provider_type}")`,
    );
  }

  const profile = session.ai_profile;
  if (!profile?.provider)
    throw new Error("Chat session AI profile has no provider");
  const provider = await getSessionProviderWithKey(session);

  const meta = (session.provider_metadata || {}) as {
    previous_response_id?: string;
  };
  const responseId = meta.previous_response_id;
  if (!responseId)
    throw new Error("No v2 response id in provider_metadata to cancel");

  const client = (await resolveSessionClient(
    session,
    provider,
  )) as DevsAiV2Client;
  await client.cancelResponse(responseId);

  console.info("[ai-manager] cancelled v2 response", { sessionId, responseId });
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
  if (session.status !== "active")
    throw new Error(`Chat session ${sessionId} is ${session.status}`);
  if (session.provider_type !== "devs-ai-v2") {
    throw new Error(
      `stream reconnect is only supported for devs-ai-v2 sessions (got "${session.provider_type}")`,
    );
  }

  const profile = session.ai_profile;
  if (!profile?.provider)
    throw new Error("Chat session AI profile has no provider");
  const provider = await getSessionProviderWithKey(session);

  const meta = (session.provider_metadata || {}) as {
    previous_response_id?: string;
    last_sequence?: number;
  };
  const responseId = meta.previous_response_id;
  if (!responseId)
    throw new Error("No v2 response id in provider_metadata to reconnect");

  const lastSequence =
    options.lastSequence != null
      ? options.lastSequence
      : Number(meta.last_sequence ?? 0) || 0;

  const client = (await resolveSessionClient(
    session,
    provider,
  )) as DevsAiV2Client;
  const timeoutMs = await resolveTimeoutMs({}, provider);
  const sseResponse = await client.reconnectResponseStream(
    responseId,
    lastSequence,
    { timeoutMs },
  );

  console.info("[ai-manager] reconnecting v2 stream", {
    sessionId,
    responseId,
    lastSequence,
  });
  return { response: sseResponse, sessionId };
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
    role: "assistant",
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

  if (
    options.fromProvider &&
    session.provider_type === "devs-ai" &&
    session.external_chat_id
  ) {
    if (session.ai_profile?.provider) {
      const provider = await getSessionProviderWithKey(session);
      const client = await resolveSessionClient(session, provider);
      if (typeof (client as DevsAiClient).getChatSession === "function") {
        return (client as DevsAiClient).getChatSession(
          session.external_chat_id,
        );
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
export async function closeChatSession(
  sessionId: string,
): Promise<ChatSessionRow> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);
  return dbUpdateSession(sessionId, { status: "closed" });
}

/**
 * Reset a chat session — clear messages and optionally reset the remote session.
 */
export async function resetChatSession(
  sessionId: string,
): Promise<ChatSessionRow> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);

  if (session.provider_type === "devs-ai" && session.external_chat_id) {
    try {
      if (session.ai_profile?.provider) {
        const provider = await getSessionProviderWithKey(session);
        const client = await resolveSessionClient(session, provider);
        if (typeof (client as DevsAiClient).resetChatSession === "function") {
          await (client as DevsAiClient).resetChatSession(
            session.external_chat_id,
          );
        }
      }
    } catch (_err) {
      /* best-effort */
    }
  }

  await deleteChatMessages(sessionId);

  const resetUpdates: Partial<ChatSessionRow> = {
    status: "active",
    message_count: session.system_prompt ? 1 : 0,
    total_prompt_tokens: 0,
    total_completion_tokens: 0,
    workflow_variables: {},
  };
  if (session.provider_type === "devs-ai-v2") {
    resetUpdates.provider_metadata = null;
  }

  if (session.system_prompt) {
    await createChatMessage({
      chat_session_id: sessionId,
      role: "system",
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

  if (session.provider_type === "devs-ai" && session.external_chat_id) {
    try {
      if (session.ai_profile?.provider) {
        const provider = await getSessionProviderWithKey(session);
        const client = await resolveSessionClient(session, provider);
        if (typeof (client as DevsAiClient).deleteChatSession === "function") {
          await (client as DevsAiClient).deleteChatSession(
            session.external_chat_id,
          );
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
      | "id"
      | "ai_profile_id"
      | "provider_type"
      | "external_chat_id"
      | "uses_user_credentials"
      | "user_id"
    >
  > = [];
  try {
    const { data, error } = await tenantFrom("chat_sessions")
      .select(
        "id, ai_profile_id, provider_type, external_chat_id, uses_user_credentials, user_id",
      )
      .eq("user_id", userId)
      .eq("provider_type", "devs-ai")
      .not("external_chat_id", "is", null);
    if (error) throw new Error(error.message);
    rows = (data as typeof rows) || [];
  } catch (err) {
    console.warn(
      "[ai-manager] purgeRemoteChatsForUser: failed to list sessions:",
      errorMessage(err),
    );
    return 0;
  }

  let purged = 0;
  for (const row of rows) {
    try {
      const provider = await getSessionProviderWithKey(row as ChatSessionRow);
      const client = await resolveSessionClient(
        row as ChatSessionRow,
        provider,
      );
      if (
        row.external_chat_id &&
        typeof (client as DevsAiClient).deleteChatSession === "function"
      ) {
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

/**
 * Upload structured rows to Devs.ai datasources using deterministic chunking.
 * This is AI Manager-owned logic so all calling applications share one behavior.
 *
 * NOTE: This function does NOT delete existing datasources. Calling applications
 * choose delete strategy and can pass delete results for diagnostics metadata.
 */
export async function uploadApiDataSourcesChunked(
  options: UploadChunkedOptions = {},
): Promise<Record<string, unknown>> {
  const {
    jobSlug = null,
    jobId = null,
    callingApplication = "unknown",
    rows = [],
    maxChunkBytes = 750_000,
    namePrefix = "datasource",
    operationType = "datasource-upload",
    preDeleteSummary = null,
  } = options;

  if (!jobSlug && !jobId) {
    throw new Error("uploadApiDataSourcesChunked requires jobSlug or jobId");
  }

  const job = jobId
    ? await getProcessingJob(jobId)
    : await getProcessingJobBySlug(jobSlug ?? "");
  if (!job) throw new Error(`Processing job not found (${jobId || jobSlug})`);

  const profile = job.ai_profile
    ? hydrateAiProfileProviderKeys(job.ai_profile)
    : job.ai_profile;
  const provider: ProviderRow | undefined = profile?.provider;
  const aiId = String(profile?.external_ai_id || "").trim();
  if (!provider || provider.type !== "devs-ai") {
    throw new Error(
      "Chunked datasource upload is only supported for Devs.ai provider",
    );
  }
  if (!aiId) throw new Error("Processing job AI profile has no external_ai_id");

  const diag = new DiagnosticSession(
    job.id,
    callingApplication,
    true,
    job.workspace_id,
  );
  const startedAtMs = Date.now();
  const chunks = splitRowsByByteCap(rows, maxChunkBytes);
  const summary: UploadSummary = {
    operationType,
    startedAt: new Date(startedAtMs).toISOString(),
    jobSlug: job.slug,
    aiProfileId: profile?.id,
    aiProfileName: profile?.name,
    aiId,
    maxBytesPerChunk: maxChunkBytes,
    totalMappings: rows.length,
    estimatedBytes: payloadBytes(rows),
    totalChunks: chunks.length,
    uploadedDataSources: [],
    failedChunks: [],
    preDeleteSummary,
  };

  diag.logRequestPayload({
    operationType,
    jobSlug: job.slug,
    aiId,
    profileId: profile?.id,
    profileName: profile?.name,
    totalMappings: rows.length,
    maxChunkBytes,
  });

  try {
    if (!provider.api_key) {
      throw new Error(`Provider "${provider.name}" has no API key configured`);
    }
    const client = new DevsAiClient(provider.base_url, provider.api_key);
    for (let i = 0; i < chunks.length; i += 1) {
      const chunkRows = chunks[i];
      if (!chunkRows) continue;
      const chunkBytes = payloadBytes(chunkRows);
      const chunkName = buildChunkName(namePrefix, i, chunks.length);
      try {
        const created = (await client.createApiDataSource(aiId, chunkName, {
          mappings: chunkRows,
        })) as Record<string, unknown> | null;
        const createdData = created?.data as
          | Record<string, unknown>
          | undefined;
        const dataSourceId: string | null =
          (created?.dataSourceId as string) ||
          (createdData?.id as string) ||
          (created?.id as string) ||
          null;
        let refreshed = false;
        let refreshError: string | null = null;
        if (dataSourceId) {
          try {
            await client.refreshDataSource(dataSourceId, true);
            refreshed = true;
          } catch (err: unknown) {
            refreshError = errorMessage(err);
          }
        }
        summary.uploadedDataSources.push({
          index: i,
          name: chunkName,
          rows: chunkRows.length,
          bytes: chunkBytes,
          dataSourceId,
          refreshed,
          refreshError,
        });
      } catch (err: unknown) {
        summary.failedChunks.push({
          index: i,
          name: chunkName,
          rows: chunkRows.length,
          bytes: chunkBytes,
          error: errorMessage(err),
        });
      }
    }

    summary.completedAt = new Date().toISOString();
    summary.totalDurationMs = Date.now() - startedAtMs;
    summary.status =
      summary.failedChunks.length > 0 ? "partial_failure" : "success";
    diag.addMetadata("operationType", operationType);
    diag.addMetadata("preDeleteSummary", preDeleteSummary);
    diag.addMetadata("uploadedDataSources", summary.uploadedDataSources);
    diag.addMetadata("failedChunks", summary.failedChunks);
    diag.addMetadata("totalMappings", summary.totalMappings);
    diag.addMetadata("totalChunks", summary.totalChunks);
    diag.addMetadata("estimatedBytes", summary.estimatedBytes);
    if (summary.failedChunks.length > 0) {
      await diag.complete(
        "error",
        `Chunk upload failed for ${summary.failedChunks.length} chunk(s)`,
      );
      throw Object.assign(
        new Error(
          `Datasource upload partial failure: ${summary.failedChunks.length} chunk(s) failed`,
        ),
        { summary },
      );
    }

    await diag.complete("success");
    return summary;
  } catch (err: unknown) {
    if (!(err instanceof Error && "summary" in err)) {
      await diag.complete("error", errorMessage(err));
    }
    throw err;
  }
}

/* ── Internal helpers (not exported) ──────────────────────── */

async function getSessionProviderWithKey(
  session: ChatSessionRow,
): Promise<ProviderRow> {
  const profileId = session.ai_profile?.id || session.ai_profile_id;
  if (!profileId) throw new Error("Chat session has no AI profile");
  const fullProfile = await getAiProfileWithKeys(profileId);
  if (!fullProfile?.provider)
    throw new Error("AI profile has no provider with credentials");
  return fullProfile.provider;
}

/**
 * Choose the correct LLM client based on how the session was created.
 * Sessions opened with user credentials continue using that user's key;
 * all others use the workspace-shared provider key.
 */
async function resolveSessionClient(
  session: ChatSessionRow,
  provider: ProviderRow,
): Promise<LlmClient> {
  if (session.uses_user_credentials && session.user_id) {
    return createLlmClientForUser(provider, session.user_id);
  }
  return createLlmClientForProvider(provider);
}

/**
 * Resolve the effective timeout (ms) for an LLM call.
 * Priority: per-job override → provider setting → system default.
 */
async function resolveTimeoutMs(
  advancedConfig: Record<string, unknown>,
  provider: ProviderRow,
): Promise<number> {
  const timeoutConfig = advancedConfig?.timeout as
    | Record<string, unknown>
    | undefined;
  const jobTimeout =
    Number(timeoutConfig?.llmTimeoutMs || advancedConfig?.timeoutMs) || 0;
  if (jobTimeout > 0) return jobTimeout;

  const providerTimeout = Number(provider?.request_timeout_ms) || 0;
  if (providerTimeout > 0) return providerTimeout;

  const setting = await getSetting("default_llm_timeout_ms");
  return Number((setting?.value as Record<string, unknown>)?.value) || 300_000;
}

/**
 * Determine which workflow step_keys have been completed in a chat session
 * by checking for user messages tagged with a workflow_step_id.
 */
async function getCompletedWorkflowSteps(
  sessionId: string,
  workflowId: string,
): Promise<Set<string>> {
  const messages = await listChatMessages(sessionId);
  const completedStepIds = new Set<string>(
    messages
      .filter((m) => m.workflow_step_id)
      .map((m) => m.workflow_step_id as string),
  );
  if (completedStepIds.size === 0) return new Set();

  const steps = await listWorkflowSteps(workflowId);
  return new Set(
    steps.filter((s) => completedStepIds.has(s.id)).map((s) => s.step_key),
  );
}

/**
 * After an LLM response, attempt to parse it as JSON and extract fields
 * according to outputMappings. Uses an atomic JSONB merge (Postgres ||)
 * to prevent lost-update race conditions under concurrent step execution.
 * Best-effort: logs warnings but never throws.
 */
export async function extractAndAccumulateOutputs(
  sessionId: string,
  assistantContent: string,
  outputMappings: Record<string, string>,
): Promise<Record<string, unknown>> {
  let parsed: Record<string, unknown>;
  try {
    const jsonMatch = assistantContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    const toParse =
      jsonMatch && jsonMatch[1] ? jsonMatch[1].trim() : assistantContent.trim();
    parsed = JSON.parse(toParse);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      console.warn(
        "[workflow-vars] LLM response is not a JSON object, skipping output extraction",
      );
      return {};
    }
  } catch {
    console.warn(
      "[workflow-vars] LLM response is not valid JSON, skipping output extraction",
    );
    return {};
  }

  const newVars: Record<string, unknown> = {};
  for (const [outputField, workflowVar] of Object.entries(outputMappings)) {
    const value = resolveJsonPath(parsed, outputField);
    if (value !== undefined) {
      newVars[workflowVar] = value;
    }
  }

  if (Object.keys(newVars).length === 0) return {};

  try {
    const { data, error } = await getServiceSupabase().rpc(
      "merge_workflow_variables",
      {
        p_session_id: sessionId,
        p_new_vars: newVars,
        p_workspace_id: requireWorkspaceId(),
      },
    );
    if (error) {
      console.warn("[workflow-vars] Atomic merge failed:", error.message);
      return newVars;
    }
    return (data as Record<string, unknown>) ?? newVars;
  } catch (err) {
    console.warn(
      "[workflow-vars] Failed to persist workflow_variables:",
      errorMessage(err),
    );
    return newVars;
  }
}

/** Resolve Devs.ai tool definitions from profile.config.toolJobs. */
async function resolveProfileToolDefinitions(
  profile: AiProfileRow | null | undefined,
): Promise<unknown[] | undefined> {
  const toolJobs = getToolJobsFromProfile(profile);
  if (toolJobs.length === 0) return undefined;
  const defs = await buildToolDefinitions(toolJobs);
  return defs.length > 0 ? defs : undefined;
}

/**
 * Fulfill pending internal tool-job calls by running linked processing jobs.
 * Returns outputs ready for submitChatToolOutputs.
 */
export async function fulfillPendingToolJobCalls(
  pending: PendingToolCall[],
  profile: AiProfileRow | null | undefined,
  callingApplication: string,
): Promise<Array<{ toolCallId: string; output: string }>> {
  const toolJobs = getToolJobsFromProfile(profile);
  const nameMap = buildToolNameMap(toolJobs);
  const outputs: Array<{ toolCallId: string; output: string }> = [];

  for (const call of pending) {
    const binding = nameMap.get(call.name);
    if (!binding) continue;

    try {
      const job = await getProcessingJobBySlug(binding.jobSlug);
      if (!job) throw new Error(`Tool job "${binding.jobSlug}" not found`);
      const args = parseToolArguments(call.arguments);
      const result = await executeJobById(job.id, {
        callingApplication,
        variables: args,
      });
      outputs.push({
        toolCallId: call.toolCallId,
        output: result.formatted || result.raw || JSON.stringify({ ok: true }),
      });
      console.info("[ai-manager] fulfilled internal tool job", {
        exposeAs: call.name,
        jobSlug: binding.jobSlug,
      });
    } catch (err) {
      outputs.push({
        toolCallId: call.toolCallId,
        output: JSON.stringify({ error: errorMessage(err), verified: false }),
      });
    }
  }

  return outputs;
}

export {
  getToolJobsFromProfile,
  buildToolNameMap,
  type PendingToolCall,
  type ToolJobBinding,
};

const MAX_VARIABLE_LENGTH = 10_000;

/** Replace {{variableName}} placeholders with actual values. */
function interpolateTemplate(
  template: string,
  variables: Record<string, unknown>,
): string {
  return template.replace(
    /\{\{([\w.-]+)\}\}/g,
    (match: string, key: string): string => {
      if (variables[key] === undefined) return match;
      let value = String(variables[key]);
      if (value.length > MAX_VARIABLE_LENGTH) {
        value = value.slice(0, MAX_VARIABLE_LENGTH) + "... [truncated]";
      }
      return `<user_input name="${key}">${value}</user_input>`;
    },
  );
}

function payloadBytes(rows: Record<string, unknown>[] = []): number {
  return Buffer.byteLength(JSON.stringify({ mappings: rows || [] }), "utf8");
}

function splitRowsByByteCap(
  rows: Record<string, unknown>[] = [],
  maxBytes: number = 750_000,
): Record<string, unknown>[][] {
  const chunks: Record<string, unknown>[][] = [];
  let current: Record<string, unknown>[] = [];
  for (const row of rows) {
    const candidate = [...current, row];
    if (candidate.length > 1 && payloadBytes(candidate) > maxBytes) {
      chunks.push(current);
      current = [row];
      continue;
    }
    if (candidate.length === 1 && payloadBytes(candidate) > maxBytes) {
      chunks.push([row]);
      current = [];
      continue;
    }
    current = candidate;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function utcTag(): string {
  const now = new Date();
  const p2 = (n: number): string => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${p2(now.getUTCMonth() + 1)}${p2(now.getUTCDate())}-${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}`;
}

function buildChunkName(prefix: string, index: number, total: number): string {
  return `${prefix}-${utcTag()}-part-${index + 1}-of-${total}`;
}
