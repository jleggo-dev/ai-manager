/**
 * AI Profile Runtime Options
 * --------------------------
 * Normalizes provider-specific runtime options stored on ai_profiles and
 * converts them into chat-completion request options for each provider.
 */

const DEVS_AI_BUILTIN_TOOLS: string[] = ['web_search', 'python', 'spreadsheet', 'memory', 'sandbox'];

interface NormalisedRuntimeOptions {
  devs_ai: {
    built_in_tools: string[];
    generate_citations: boolean;
    parallel_tool_calls: boolean;
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

function normaliseToolList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  const unique = new Set<string>();
  for (const entry of raw) {
    const tool = String(entry || '')
      .trim()
      .toLowerCase();
    if (DEVS_AI_BUILTIN_TOOLS.includes(tool)) unique.add(tool);
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
  const googleInput = toObject(root.google_gemini);

  const options: NormalisedRuntimeOptions = {
    devs_ai: {
      built_in_tools: normaliseToolList(devsAiInput.built_in_tools),
      generate_citations: toBoolean(devsAiInput.generate_citations, false),
      parallel_tool_calls: toBoolean(devsAiInput.parallel_tool_calls, false),
    },
    google_gemini: {
      grounding_with_google_search: toBoolean(googleInput.grounding_with_google_search, false),
    },
  };

  /* Keep provider-irrelevant branch at defaults for predictable API shape. */
  if (normalizedProviderType === 'google-gemini') {
    options.devs_ai = {
      built_in_tools: [],
      generate_citations: false,
      parallel_tool_calls: false,
    };
  }
  if (normalizedProviderType === 'devs-ai' || !normalizedProviderType) {
    options.google_gemini = {
      grounding_with_google_search: false,
    };
  }

  return options;
}

/**
 * Build provider-specific chat completion options from normalized runtime options.
 */
export function buildProviderChatOptions(
  providerType: string = '',
  runtimeOptions: Record<string, unknown> = {},
): Record<string, unknown> {
  const normalizedProviderType = String(providerType || '')
    .trim()
    .toLowerCase();
  const normalized = normaliseAiProfileRuntimeOptions(normalizedProviderType, runtimeOptions);

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

export { DEVS_AI_BUILTIN_TOOLS };
