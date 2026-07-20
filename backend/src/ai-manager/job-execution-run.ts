/**
 * LLM call + failover + formatting for one-shot job execution.
 * Extracted from executeJobById so that function stays under the size gate.
 */
import { createLlmClientForProvider, type LlmClientInstance } from '../integrations/client-factory.ts';
import { applyFormattingRules } from '../services/formatting-rules.ts';
import { buildProviderChatOptions } from '../services/ai-profile-runtime-options.ts';
import { errorMessage } from '../lib/error-message.ts';
import { withImageParts } from '../lib/message-content.ts';
import type { DiagnosticSession } from '../services/ai-diagnostics.ts';
import type {
  AiManagerResult,
  ChatCompletionResponse,
  ChatCompletionUsage,
  ChatMessage,
  FormattingRule,
  ProviderRow,
} from '../types.ts';
import type { ExpectedSchemaInput } from '../services/expected-schema-to-json-schema.ts';
import { resolveTimeoutMs } from './job-execution-utils.ts';

interface JobConfig {
  formattingRules?: FormattingRule[];
  expectedSchema?: ExpectedSchemaInput | null;
}

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
  const content = resp.choices?.[0]?.message?.content || '';
  return {
    resp,
    content,
    nextUsage: resp.usage ?? null,
    nextFinishReason: resp.choices?.[0]?.finish_reason ?? null,
  };
}

/** Primary model call with optional failover; returns raw content + metadata. */
async function invokePrimaryOrFailover(args: {
  client: LlmClientInstance;
  provider: ProviderRow;
  profile: {
    failover_provider?: ProviderRow | null;
    failover_external_ai_id?: string | null;
    failover_runtime_options?: Record<string, unknown> | null;
    runtime_options?: Record<string, unknown> | null;
  };
  jobConfig: JobConfig;
  advancedConfig: Record<string, unknown>;
  chatOptions: Record<string, unknown>;
  primaryModel: string;
  messages: ChatMessage[];
  enableFailover: boolean;
  modelOverride: string | null;
}): Promise<{
  data: ChatCompletionResponse | null;
  rawContent: string;
  usage: ChatCompletionUsage | null;
  finishReason: string | null;
  modelUsed: string;
  failoverUsed: boolean;
  primaryErrorMessage: string;
  tried: string[];
  hasFailover: boolean;
  failoverProvider: ProviderRow | undefined;
  failoverAiId: string;
}> {
  const {
    client,
    provider,
    profile,
    jobConfig,
    advancedConfig,
    chatOptions,
    primaryModel,
    messages,
    enableFailover,
    modelOverride,
  } = args;

  const failoverProvider: ProviderRow | undefined = profile.failover_provider ?? undefined;
  const failoverAiId = String(profile.failover_external_ai_id || '').trim();
  const hasFailover = Boolean(enableFailover && !modelOverride && failoverProvider && failoverAiId);
  const effectiveTimeoutMs = await resolveTimeoutMs(advancedConfig, provider);

  let modelUsed = primaryModel;
  let failoverUsed = false;
  let primaryErrorMessage = '';
  let data: ChatCompletionResponse | null = null;
  let rawContent = '';
  let usage: ChatCompletionUsage | null = null;
  let finishReason: string | null = null;
  const tried: string[] = [];

  try {
    tried.push(primaryModel);
    const out = await callWithClient(client, primaryModel, messages, chatOptions, effectiveTimeoutMs);
    if (!String(out.content || '').trim()) {
      throw new Error(`Model "${primaryModel}" returned empty response content`);
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
        const failoverRuntimeOpts = profile.failover_runtime_options ?? profile.runtime_options ?? undefined;
        const failoverChatOpts = buildProviderChatOptions(failoverProvider.type, failoverRuntimeOpts, {
          expectedSchema:
            String(failoverProvider.type || '')
              .trim()
              .toLowerCase() === 'devs-ai-v2'
              ? (jobConfig.expectedSchema ?? undefined)
              : undefined,
        });
        const failoverTimeoutMs = await resolveTimeoutMs(advancedConfig, failoverProvider);
        tried.push(failoverAiId);
        const out = await callWithClient(failoverClient, failoverAiId, messages, failoverChatOpts, failoverTimeoutMs);
        if (!String(out.content || '').trim()) {
          throw new Error(`Failover model "${failoverAiId}" returned empty response content`, { cause: primaryErr });
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
    if (!String(rawContent || '').trim()) {
      if (failoverErr) {
        throw new Error(
          `Primary model "${primaryModel}" failed and failover "${failoverAiId}" on provider "${failoverProvider?.name}" also failed: ${failoverErr.message}`,
          { cause: primaryErr },
        );
      }
      throw primaryErr;
    }
  }

  return {
    data,
    rawContent,
    usage,
    finishReason,
    modelUsed,
    failoverUsed,
    primaryErrorMessage,
    tried,
    hasFailover,
    failoverProvider,
    failoverAiId,
  };
}

export async function runJobLlmAndFormat(args: {
  client: LlmClientInstance;
  provider: ProviderRow;
  profile: {
    name: string;
    external_ai_id?: string | null;
    failover_provider?: ProviderRow | null;
    failover_external_ai_id?: string | null;
    failover_runtime_options?: Record<string, unknown> | null;
    runtime_options?: Record<string, unknown> | null;
  };
  job: { slug: string; name: string };
  jobConfig: JobConfig;
  advancedConfig: Record<string, unknown>;
  chatOptions: Record<string, unknown>;
  primaryModel: string;
  finalPrompt: string;
  imageUrls: string[];
  enableFailover: boolean;
  modelOverride: string | null;
  fullDiagnostics: boolean;
  diag: DiagnosticSession;
  t0: number;
}): Promise<AiManagerResult> {
  const {
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
  } = args;

  const effectiveTimeoutMs = await resolveTimeoutMs(advancedConfig, provider);
  if (fullDiagnostics) diag.addMetadata('effectiveTimeoutMs', effectiveTimeoutMs);
  if (fullDiagnostics) diag.startLlmTimer();

  const messages: ChatMessage[] = [{ role: 'user', content: withImageParts(finalPrompt, imageUrls) }];
  const llm = await invokePrimaryOrFailover({
    client,
    provider,
    profile,
    jobConfig,
    advancedConfig,
    chatOptions,
    primaryModel,
    messages,
    enableFailover,
    modelOverride,
  });

  const actualProvider = llm.failoverUsed && llm.failoverProvider ? llm.failoverProvider : provider;

  if (fullDiagnostics) {
    diag.endLlmTimer(
      {
        model: llm.modelUsed,
        provider: actualProvider.name,
        promptContent: finalPrompt,
        promptLength: finalPrompt.length,
        ...(imageUrls.length ? { imageUrls } : {}),
      },
      {
        rawContent: llm.rawContent,
        rawLength: llm.rawContent.length,
        usage: llm.usage,
        finishReason: llm.finishReason,
      },
    );
  }

  if (fullDiagnostics) diag.startFormattingTimer();
  const formattingRules: FormattingRule[] = jobConfig.formattingRules || [];
  const { formatted, steps } = applyFormattingRules(llm.rawContent, formattingRules);
  if (fullDiagnostics) diag.endFormattingTimer(formattingRules.length);

  const durationMs = Date.now() - t0;
  const result: AiManagerResult = {
    raw: llm.rawContent,
    formatted,
    formattingSteps: steps,
    messageSent: finalPrompt,
    metadata: {
      durationMs,
      model: llm.data?.model || llm.modelUsed,
      usage: llm.usage,
      finishReason: llm.finishReason,
      jobSlug: job.slug,
      jobName: job.name,
      aiProfile: profile.name,
      provider: provider.name,
      ...(imageUrls.length ? { imageCount: imageUrls.length } : {}),
    },
  };

  if (fullDiagnostics) {
    diag.addMetadata('formattedLength', formatted.length);
    diag.addMetadata('rawLength', llm.rawContent.length);
    diag.addMetadata('primaryModel', primaryModel);
    diag.addMetadata('failoverUsed', llm.failoverUsed);
    diag.addMetadata('modelOverride', modelOverride || null);
    diag.addMetadata('enableFailover', enableFailover !== false);
    diag.addMetadata('modelsTried', llm.tried);
    diag.addMetadata('chatOptions', chatOptions);
    if (llm.hasFailover) {
      diag.addMetadata('failoverModel', llm.failoverAiId);
      diag.addMetadata('failoverProviderName', llm.failoverProvider?.name || null);
      diag.addMetadata('failoverProviderType', llm.failoverProvider?.type || null);
    }
    if (llm.primaryErrorMessage) diag.addMetadata('primaryModelError', llm.primaryErrorMessage);
  }

  return result;
}
