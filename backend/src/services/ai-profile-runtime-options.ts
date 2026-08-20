/**
 * AI Profile Runtime Options
 * --------------------------
 * Normalizes provider-specific runtime options stored on ai_profiles and
 * converts them into chat-completion / v2 response request options.
 */

import { expectedSchemaFieldsToJsonSchema, type ExpectedSchemaInput } from './expected-schema-to-json-schema.ts';

const DEVS_AI_BUILTIN_TOOLS: string[] = ['web_search', 'python', 'spreadsheet', 'memory', 'sandbox'];

const DEVS_AI_V2_BUILTIN_TOOLS: string[] = [
  'web_search',
  'python',
  'spreadsheet',
  'memory',
  'sandbox',
  'image_generation',
  'deep_research',
];

interface NormalisedRuntimeOptions {
  devs_ai: {
    built_in_tools: string[];
    generate_citations: boolean;
    parallel_tool_calls: boolean;
  };
  devs_ai_v2: {
    built_in_tools: string[];
    parallel_tool_calls: boolean;
    chat_mode: 'execute' | 'chat' | 'plan';
    thread_mode: 'collect' | 'steer' | 'interrupt' | 'force';
    /** Server-side threading: send only NEW input under previous_response_id (see thread-mode.ts). */
    threading: boolean;
    reasoning_effort?: string;
  };
  google_gemini: {
    grounding_with_google_search: boolean;
  };
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toBoolean(value: unknown, fallback: boolean = false): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function normaliseToolList(value: unknown, allowed: string[]): string[] {
  const raw = Array.isArray(value) ? value : [];
  const unique = new Set<string>();
  for (const entry of raw) {
    const tool = String(entry || '')
      .trim()
      .toLowerCase();
    if (allowed.includes(tool)) unique.add(tool);
  }
  return [...unique];
}

/**
 * Normalize runtime options from request payload/storage.
 * Always returns a stable shape so frontend/backend stay consistent.
 */
export function normaliseAiProfileRuntimeOptions(
  providerType: string = '',
  input: Record<string, unknown> = {},
): NormalisedRuntimeOptions {
  const normalizedProviderType = String(providerType || '')
    .trim()
    .toLowerCase();
  const root = toObject(input);

  const devsAiInput = toObject(root.devs_ai);
  const devsAiV2Input = toObject(root.devs_ai_v2);
  const googleInput = toObject(root.google_gemini);

  const chatModeRaw = String(devsAiV2Input.chat_mode || 'execute').toLowerCase();
  const chatMode = (['execute', 'chat', 'plan'] as const).includes(chatModeRaw as 'execute' | 'chat' | 'plan')
    ? (chatModeRaw as 'execute' | 'chat' | 'plan')
    : 'execute';

  const threadModeRaw = String(devsAiV2Input.thread_mode || 'collect').toLowerCase();
  const threadMode = (['collect', 'steer', 'interrupt', 'force'] as const).includes(
    threadModeRaw as 'collect' | 'steer' | 'interrupt' | 'force',
  )
    ? (threadModeRaw as 'collect' | 'steer' | 'interrupt' | 'force')
    : 'collect';

  const options: NormalisedRuntimeOptions = {
    devs_ai: {
      built_in_tools: normaliseToolList(devsAiInput.built_in_tools, DEVS_AI_BUILTIN_TOOLS),
      generate_citations: toBoolean(devsAiInput.generate_citations, false),
      parallel_tool_calls: toBoolean(devsAiInput.parallel_tool_calls, false),
    },
    devs_ai_v2: {
      built_in_tools: normaliseToolList(devsAiV2Input.built_in_tools, DEVS_AI_V2_BUILTIN_TOOLS),
      parallel_tool_calls: toBoolean(devsAiV2Input.parallel_tool_calls, true),
      chat_mode: chatMode,
      thread_mode: threadMode,
      threading: toBoolean(devsAiV2Input.threading, false),
      reasoning_effort: devsAiV2Input.reasoning_effort ? String(devsAiV2Input.reasoning_effort) : undefined,
    },
    google_gemini: {
      grounding_with_google_search: toBoolean(googleInput.grounding_with_google_search, false),
    },
  };

  if (normalizedProviderType === 'google-gemini') {
    options.devs_ai = { built_in_tools: [], generate_citations: false, parallel_tool_calls: false };
    options.devs_ai_v2 = {
      built_in_tools: [],
      parallel_tool_calls: true,
      chat_mode: 'execute',
      thread_mode: 'collect',
      threading: false,
    };
  }
  if (normalizedProviderType === 'devs-ai' || (!normalizedProviderType && normalizedProviderType !== 'devs-ai-v2')) {
    options.google_gemini = { grounding_with_google_search: false };
    options.devs_ai_v2 = {
      built_in_tools: [],
      parallel_tool_calls: true,
      chat_mode: 'execute',
      thread_mode: 'collect',
      threading: false,
    };
  }
  if (normalizedProviderType === 'devs-ai-v2') {
    options.devs_ai = { built_in_tools: [], generate_citations: false, parallel_tool_calls: false };
    options.google_gemini = { grounding_with_google_search: false };
  }

  return options;
}

export interface BuildChatOptionsExtra {
  expectedSchema?: ExpectedSchemaInput | null;
  previousResponseId?: string | null;
  conversationId?: string | null;
}

/**
 * Build provider-specific chat completion / v2 response options from normalized runtime options.
 */
/**
 * Is server-side threading ON for this profile? (devs-ai-v2 only, opt-in, default off.)
 *
 * The gate for everything thread-mode does: when true, the send path passes
 * `previous_response_id`, slices `input` down to what the server thread has not seen
 * (thread-mode.ts), and skips local compaction — the provider owns the history
 * (a long-lived ThreadWorkflow with an org-level context budget), and duplicating that
 * client-side costs tokens and quality (owner, 2026-08-19). When false — every other
 * provider, and v2 by default — the engine stays stateless: full history each turn,
 * local compaction available. That path is the fallback story for providers with no
 * server-side thread at all (e.g. a future Vercel AI Gateway).
 */
export function v2ThreadingEnabled(providerType: string, runtimeOptions: Record<string, unknown> = {}): boolean {
  const t = String(providerType || '')
    .trim()
    .toLowerCase();
  if (t !== 'devs-ai-v2') return false;
  return normaliseAiProfileRuntimeOptions(t, runtimeOptions).devs_ai_v2.threading;
}

export function buildProviderChatOptions(
  providerType: string = '',
  runtimeOptions: Record<string, unknown> = {},
  extra: BuildChatOptionsExtra = {},
): Record<string, unknown> {
  const normalizedProviderType = String(providerType || '')
    .trim()
    .toLowerCase();
  const normalized = normaliseAiProfileRuntimeOptions(normalizedProviderType, runtimeOptions);

  if (normalizedProviderType === 'devs-ai-v2') {
    const tools = (normalized.devs_ai_v2.built_in_tools || []).map((toolType) => ({ type: toolType }));
    const options: Record<string, unknown> = {
      parallel_tool_calls: normalized.devs_ai_v2.parallel_tool_calls,
      chat_mode: normalized.devs_ai_v2.chat_mode,
      thread_mode: normalized.devs_ai_v2.thread_mode,
    };
    if (tools.length > 0) options.tools = tools;
    if (normalized.devs_ai_v2.reasoning_effort) {
      options.reasoning = { effort: normalized.devs_ai_v2.reasoning_effort };
    }
    if (extra.previousResponseId) options.previous_response_id = extra.previousResponseId;
    if (extra.conversationId) options.conversation = extra.conversationId;
    if (extra.expectedSchema) {
      const schemaFormat = expectedSchemaFieldsToJsonSchema(extra.expectedSchema);
      if (schemaFormat) options.text = schemaFormat;
    }
    return options;
  }

  if (normalizedProviderType === 'devs-ai' || !normalizedProviderType) {
    const tools = (normalized.devs_ai.built_in_tools || []).map((toolType) => ({ type: toolType }));
    const options: Record<string, unknown> = {};
    if (tools.length > 0) options.tools = tools;
    if (normalized.devs_ai.generate_citations) options.generateCitations = true;
    if (normalized.devs_ai.parallel_tool_calls) options.parallel_tool_calls = true;
    return options;
  }

  if (normalizedProviderType === 'google-gemini') {
    return {
      groundingWithGoogleSearch: normalized.google_gemini.grounding_with_google_search === true,
    };
  }

  return {};
}

export { DEVS_AI_BUILTIN_TOOLS, DEVS_AI_V2_BUILTIN_TOOLS };
