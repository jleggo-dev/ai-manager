export interface RuntimeOptions {
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
    reasoning_effort?: string;
  };
  google_gemini: {
    grounding_with_google_search: boolean;
  };
}

export const DEVS_AI_BUILTIN_TOOL_OPTIONS = [
  { key: 'web_search', label: 'Web Search' },
  { key: 'python', label: 'Python' },
  { key: 'spreadsheet', label: 'Spreadsheet' },
  { key: 'memory', label: 'Memory' },
  { key: 'sandbox', label: 'Sandbox' },
] as const;

export const DEVS_AI_V2_BUILTIN_TOOL_OPTIONS = [
  ...DEVS_AI_BUILTIN_TOOL_OPTIONS,
  { key: 'image_generation', label: 'Image Generation' },
  { key: 'deep_research', label: 'Deep Research' },
] as const;

export const DEVS_AI_V2_CHAT_MODE_OPTIONS = [
  { value: 'execute', label: 'Execute' },
  { value: 'chat', label: 'Chat' },
  { value: 'plan', label: 'Plan' },
] as const;

export const DEVS_AI_V2_THREAD_MODE_OPTIONS = [
  { value: 'collect', label: 'Collect' },
  { value: 'steer', label: 'Steer' },
  { value: 'interrupt', label: 'Interrupt' },
  { value: 'force', label: 'Force' },
] as const;

export const DEFAULT_RUNTIME_OPTIONS: RuntimeOptions = {
  devs_ai: {
    built_in_tools: [],
    generate_citations: false,
    parallel_tool_calls: false,
  },
  devs_ai_v2: {
    built_in_tools: [],
    parallel_tool_calls: true,
    chat_mode: 'execute',
    thread_mode: 'collect',
  },
  google_gemini: {
    grounding_with_google_search: false,
  },
};

export function normaliseRuntimeOptions(raw: unknown = {}, providerType: string = ''): RuntimeOptions {
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : ({} as Record<string, unknown>);
  const devs =
    root.devs_ai && typeof root.devs_ai === 'object'
      ? (root.devs_ai as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const devsV2 =
    root.devs_ai_v2 && typeof root.devs_ai_v2 === 'object'
      ? (root.devs_ai_v2 as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const gemini =
    root.google_gemini && typeof root.google_gemini === 'object'
      ? (root.google_gemini as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const chatModeRaw = String(devsV2.chat_mode || 'execute').toLowerCase();
  const chatMode = (['execute', 'chat', 'plan'] as const).includes(chatModeRaw as 'execute' | 'chat' | 'plan')
    ? (chatModeRaw as 'execute' | 'chat' | 'plan')
    : 'execute';

  const threadModeRaw = String(devsV2.thread_mode || 'collect').toLowerCase();
  const threadMode = (['collect', 'steer', 'interrupt', 'force'] as const).includes(
    threadModeRaw as 'collect' | 'steer' | 'interrupt' | 'force',
  )
    ? (threadModeRaw as 'collect' | 'steer' | 'interrupt' | 'force')
    : 'collect';

  const options: RuntimeOptions = {
    devs_ai: {
      built_in_tools: Array.isArray(devs.built_in_tools)
        ? [
            ...new Set(
              devs.built_in_tools
                .map((t: unknown) =>
                  String(t || '')
                    .trim()
                    .toLowerCase(),
                )
                .filter(Boolean),
            ),
          ]
        : [],
      generate_citations: devs.generate_citations === true,
      parallel_tool_calls: devs.parallel_tool_calls === true,
    },
    devs_ai_v2: {
      built_in_tools: Array.isArray(devsV2.built_in_tools)
        ? [
            ...new Set(
              devsV2.built_in_tools
                .map((t: unknown) =>
                  String(t || '')
                    .trim()
                    .toLowerCase(),
                )
                .filter(Boolean),
            ),
          ]
        : [],
      parallel_tool_calls: devsV2.parallel_tool_calls !== false,
      chat_mode: chatMode,
      thread_mode: threadMode,
      reasoning_effort: devsV2.reasoning_effort ? String(devsV2.reasoning_effort) : undefined,
    },
    google_gemini: {
      grounding_with_google_search: gemini.grounding_with_google_search === true,
    },
  };

  const normalizedType = String(providerType || '').toLowerCase();
  if (normalizedType === 'google-gemini') {
    options.devs_ai = { built_in_tools: [], generate_citations: false, parallel_tool_calls: false };
    options.devs_ai_v2 = { built_in_tools: [], parallel_tool_calls: true, chat_mode: 'execute', thread_mode: 'collect' };
  }
  if (normalizedType === 'devs-ai') {
    options.google_gemini = { grounding_with_google_search: false };
    options.devs_ai_v2 = { built_in_tools: [], parallel_tool_calls: true, chat_mode: 'execute', thread_mode: 'collect' };
  }
  if (normalizedType === 'devs-ai-v2') {
    options.devs_ai = { built_in_tools: [], generate_citations: false, parallel_tool_calls: false };
    options.google_gemini = { grounding_with_google_search: false };
  }

  return options;
}
