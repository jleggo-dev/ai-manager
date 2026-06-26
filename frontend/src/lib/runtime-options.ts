export interface RuntimeOptions {
  devs_ai: {
    built_in_tools: string[];
    generate_citations: boolean;
    parallel_tool_calls: boolean;
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

export const DEFAULT_RUNTIME_OPTIONS: RuntimeOptions = {
  devs_ai: {
    built_in_tools: [],
    generate_citations: false,
    parallel_tool_calls: false,
  },
  google_gemini: {
    grounding_with_google_search: false,
  },
};

export function normaliseRuntimeOptions(raw: unknown = {}): RuntimeOptions {
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : ({} as Record<string, unknown>);
  const devs =
    root.devs_ai && typeof root.devs_ai === 'object'
      ? (root.devs_ai as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const gemini =
    root.google_gemini && typeof root.google_gemini === 'object'
      ? (root.google_gemini as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  return {
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
    google_gemini: {
      grounding_with_google_search: gemini.grounding_with_google_search === true,
    },
  };
}
