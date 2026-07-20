/**
 * AI Manager — Job Execution
 * ===========================
 * One-shot processing-job runs: resolve job → profile → provider, interpolate
 * the prompt, call the LLM (with optional failover), apply formatting rules,
 * and record diagnostics.
 */

import { getProcessingJobBySlug, getProcessingJob, updateProcessingJob } from '../models/processing-jobs.ts';
import { upsertCallingApplication } from '../models/calling-applications.ts';
import { hydrateAiProfileProviderKeys } from '../models/ai-profiles.ts';
import { DevsAiClient } from '../integrations/devs-ai/client.ts';
import type { ExpectedSchemaInput } from '../services/expected-schema-to-json-schema.ts';
import { createLlmClientForProvider } from '../integrations/client-factory.ts';
import { DiagnosticSession, shouldRunDiagnostics } from '../services/ai-diagnostics.ts';
import { buildProviderChatOptions } from '../services/ai-profile-runtime-options.ts';
import { resolveAttachmentsAsText } from '../services/attachment-resolver.ts';
import { getConfig } from '../config.ts';
import { errorMessage } from '../lib/error-message.ts';
import type { AiManagerResult, Attachment, FormattingRule, ProcessingJobRow, ProviderRow } from '../types.ts';
import { interpolateTemplate } from './job-execution-utils.ts';
import { runJobLlmAndFormat } from './job-execution-run.ts';

export { interpolateTemplate, resolveTimeoutMs } from './job-execution-utils.ts';

interface ExecuteJobOptions {
  callingApplication?: string;
  variables?: Record<string, unknown>;
  promptOverride?: string | null;
  modelOverride?: string | null;
  enableFailover?: boolean;
  /** https image URLs attached as vision content parts AFTER template interpolation.
   *  Templates stay text-only; diagnostics record the URL references, never image bytes. */
  images?: string[];
}

interface ExecuteJobByIdOptions extends ExecuteJobOptions {
  attachments?: Attachment[];
  _job?: ProcessingJobRow | null;
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
export async function executeJob(jobSlug: string, options: ExecuteJobOptions = {}): Promise<AiManagerResult> {
  const {
    callingApplication = 'unknown',
    variables = {},
    promptOverride = null,
    modelOverride = null,
    enableFailover = true,
    images = [],
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
    images,
    _job: job,
  });
}

/**
 * Execute a processing job by ID.
 * Same as executeJob() but uses the job ID directly.
 */
export async function executeJobById(jobId: string, options: ExecuteJobByIdOptions = {}): Promise<AiManagerResult> {
  const {
    callingApplication = 'unknown',
    variables = {},
    promptOverride = null,
    modelOverride = null,
    enableFailover = true,
    attachments = [],
    images = [],
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
  if (callingApplication && callingApplication !== 'unknown' && callingApplication !== 'ai-admin-test') {
    try {
      await upsertCallingApplication(callingApplication, callingApplication);
      console.info(`[ai-manager] Registered calling application: "${callingApplication}"`);
      if (!job.calling_application_id) {
        await updateProcessingJob(job.id, {
          calling_application_id: callingApplication,
        });
        job.calling_application_id = callingApplication;
      }
    } catch (autoRegErr: unknown) {
      console.warn('[ai-manager] auto-register calling app failed (non-fatal):', errorMessage(autoRegErr));
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
  const diag = new DiagnosticSession(job.id, callingApplication, true, job.workspace_id);

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

    const profile = job.ai_profile ? hydrateAiProfileProviderKeys(job.ai_profile) : job.ai_profile;
    const provider: ProviderRow | undefined = profile?.provider;

    if (!profile || !provider) {
      if (fullDiagnostics) diag.endSupabaseTimer('resolve-ai-client', false, 'No AI profile or provider assigned');
      throw new Error('Processing job has no AI profile or provider assigned');
    }

    const client = createLlmClientForProvider(provider);
    const primaryModel = String(modelOverride || profile.external_ai_id || '').trim();
    const providerTypeNorm = String(provider.type || '')
      .trim()
      .toLowerCase();
    const chatOptions = buildProviderChatOptions(provider.type, profile.runtime_options ?? undefined, {
      expectedSchema: providerTypeNorm === 'devs-ai-v2' ? (jobConfig.expectedSchema ?? undefined) : undefined,
    });

    if (fullDiagnostics) diag.endSupabaseTimer('resolve-ai-client', true);

    /* ── 4. Build the final prompt ────────────────────────── */
    let finalPrompt: string;
    if (promptOverride) {
      finalPrompt = promptOverride;
    } else {
      const template: string = jobConfig.promptTemplate || '';
      if (!template.trim()) {
        throw new Error('No prompt template configured for this job');
      }
      finalPrompt = interpolateTemplate(template, variables);
    }

    /* ── 4b. Inject text file attachments into prompt ─────── */
    if (attachments.length > 0) {
      const textFiles = await resolveAttachmentsAsText(attachments);
      if (textFiles.length > 0) {
        const fileBlock = textFiles.map((f) => `--- ${f.fileName} ---\n${f.content}`).join('\n\n');
        finalPrompt = `${fileBlock}\n\n---\n\n${finalPrompt}`;
      }
    }

    /* ── 4c. Attach image parts (vision) ──────────────────────
     *  URLs only (https, e.g. short-lived signed Storage URLs) — never inline
     *  base64. The prompt TEXT stays `finalPrompt` everywhere it is logged;
     *  images ride as content parts the provider layer maps to its dialect. */
    const imageUrls = images.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u));

    const result = await runJobLlmAndFormat({
      client,
      provider,
      profile,
      job,
      jobConfig,
      advancedConfig,
      chatOptions,
      primaryModel,
      finalPrompt,
      imageUrls,
      enableFailover,
      modelOverride,
      fullDiagnostics,
      diag,
      t0,
    });

    diag.complete('success').catch((diagErr: unknown) => {
      console.warn('[AI Manager] Non-blocking diagnostics write failed:', errorMessage(diagErr));
    });

    return result;
  } catch (err: unknown) {
    diag.complete('error', errorMessage(err)).catch(() => {});
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
    throw new Error('DEVS_AI_API_KEY is not configured');
  }
  const client = new DevsAiClient(cfg.devsAi.baseUrl, cfg.devsAi.apiKey);
  const model = cfg.devsAi.defaultModel;

  const t0 = Date.now();
  const data = await client.chatCompletion(model, [{ role: 'user', content: prompt }]);
  const durationMs = Date.now() - t0;

  return {
    raw: data.choices?.[0]?.message?.content || '',
    formatted: data.choices?.[0]?.message?.content || '',
    formattingSteps: [],
    messageSent: prompt,
    metadata: {
      durationMs,
      model: data.model || model,
      usage: data.usage || null,
      finishReason: data.choices?.[0]?.finish_reason || null,
      jobSlug: null,
      jobName: null,
      aiProfile: 'env-default',
      provider: 'env-default',
    },
  };
}
