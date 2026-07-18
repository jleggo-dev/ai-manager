/**
 * ai-profiles/ProfileRuntimeOptions
 * -----------------------------
 * Per-provider runtime-option panels (Devs.ai, Devs.ai v2, Google Gemini) plus
 * the nested MCP tools list for Devs.ai model profiles.
 * Extracted from ProfileFormModal (FE-02) as a structural, behavior-preserving move.
 */

import { Paper, Select, Stack, Switch, Text } from '@mantine/core';
import McpToolsPanel, { type McpTool, type ToolAuthEntry } from './McpToolsPanel';
import type { AiProfile } from '../../../types/api';
import {
  DEVS_AI_BUILTIN_TOOL_OPTIONS,
  DEVS_AI_V2_BUILTIN_TOOL_OPTIONS,
  DEVS_AI_V2_CHAT_MODE_OPTIONS,
  DEVS_AI_V2_THREAD_MODE_OPTIONS,
  normaliseRuntimeOptions,
  type RuntimeOptions,
} from '../../../lib/runtime-options';

interface ProfileRuntimeOptionsProps {
  selectedProviderType: string;
  effectiveProfileType: string;
  runtimeOptions: RuntimeOptions;
  /** Functional update mirroring the original setForm(prev => … runtime_options) pattern. */
  patchRuntimeOptions: (updater: (prev: RuntimeOptions) => RuntimeOptions) => void;
  editing: AiProfile | null;
  mcpTools: McpTool[];
  toolAuthStatus: ToolAuthEntry[];
  mcpLoading: boolean;
  onRefreshMcp: (profileId: string) => void;
}

export default function ProfileRuntimeOptions({
  selectedProviderType,
  effectiveProfileType,
  runtimeOptions,
  patchRuntimeOptions,
  editing,
  mcpTools,
  toolAuthStatus,
  mcpLoading,
  onRefreshMcp,
}: ProfileRuntimeOptionsProps) {
  function toggleDevsAiV2Tool(toolKey: string, enabled: boolean) {
    patchRuntimeOptions((prev) => {
      const normalised = normaliseRuntimeOptions(prev, selectedProviderType);
      const currentTools = normalised.devs_ai_v2.built_in_tools;
      const nextTools: string[] = enabled
        ? Array.from(new Set<string>([...currentTools, toolKey]))
        : currentTools.filter((t: string) => t !== toolKey);
      return {
        ...normalised,
        devs_ai_v2: {
          ...normalised.devs_ai_v2,
          built_in_tools: nextTools,
        },
      };
    });
  }

  function toggleDevsAiTool(toolKey: string, enabled: boolean) {
    patchRuntimeOptions((prev) => {
      const normalised = normaliseRuntimeOptions(prev);
      const currentTools = normalised.devs_ai.built_in_tools;
      const nextTools: string[] = enabled
        ? Array.from(new Set<string>([...currentTools, toolKey]))
        : currentTools.filter((t: string) => t !== toolKey);
      return {
        ...normalised,
        devs_ai: {
          ...normalised.devs_ai,
          built_in_tools: nextTools,
        },
      };
    });
  }

  return (
    <>
      {selectedProviderType === 'devs-ai' && effectiveProfileType === 'model' && (
        <Paper withBorder p="sm" radius="sm">
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              Devs.ai Runtime Options
            </Text>
            <Text size="xs" c="dimmed">
              Enable built-in tools and chat options for this model profile.
            </Text>
            {DEVS_AI_BUILTIN_TOOL_OPTIONS.map((tool) => (
              <Switch
                key={tool.key}
                size="sm"
                label={tool.label}
                checked={normaliseRuntimeOptions(runtimeOptions).devs_ai.built_in_tools.includes(tool.key)}
                onChange={(e) => toggleDevsAiTool(tool.key, e.currentTarget.checked)}
              />
            ))}
            <Switch
              size="sm"
              label="Generate Citations"
              checked={normaliseRuntimeOptions(runtimeOptions).devs_ai.generate_citations}
              onChange={(e) => {
                const checked = e.currentTarget.checked;
                patchRuntimeOptions((prev) => {
                  const normalised = normaliseRuntimeOptions(prev);
                  return {
                    ...normalised,
                    devs_ai: {
                      ...normalised.devs_ai,
                      generate_citations: checked,
                    },
                  };
                });
              }}
            />
            <Switch
              size="sm"
              label="Parallel Tool Calls"
              description="Allow the AI to invoke multiple tools simultaneously"
              checked={normaliseRuntimeOptions(runtimeOptions).devs_ai.parallel_tool_calls}
              onChange={(e) => {
                const checked = e.currentTarget.checked;
                patchRuntimeOptions((prev) => {
                  const normalised = normaliseRuntimeOptions(prev);
                  return {
                    ...normalised,
                    devs_ai: {
                      ...normalised.devs_ai,
                      parallel_tool_calls: checked,
                    },
                  };
                });
              }}
            />

            {/* MCP Server Tools (dynamic, fetched from Devs.ai) */}
            {editing && (
              <McpToolsPanel
                editing={editing}
                mcpTools={mcpTools}
                toolAuthStatus={toolAuthStatus}
                mcpLoading={mcpLoading}
                onRefresh={() => onRefreshMcp(editing.id)}
              />
            )}
          </Stack>
        </Paper>
      )}

      {selectedProviderType === 'devs-ai-v2' && effectiveProfileType === 'model' && (
        <Paper withBorder p="sm" radius="sm">
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              Devs.ai v2 Runtime Options
            </Text>
            <Text size="xs" c="dimmed">
              Responses API v2 — built-in tools, chat mode, and threading behavior.
            </Text>
            {DEVS_AI_V2_BUILTIN_TOOL_OPTIONS.map((tool) => (
              <Switch
                key={tool.key}
                size="sm"
                label={tool.label}
                checked={normaliseRuntimeOptions(runtimeOptions, 'devs-ai-v2').devs_ai_v2.built_in_tools.includes(
                  tool.key,
                )}
                onChange={(e) => toggleDevsAiV2Tool(tool.key, e.currentTarget.checked)}
              />
            ))}
            <Select
              label="Chat mode"
              size="xs"
              data={[...DEVS_AI_V2_CHAT_MODE_OPTIONS]}
              value={normaliseRuntimeOptions(runtimeOptions, 'devs-ai-v2').devs_ai_v2.chat_mode}
              onChange={(val) => {
                if (!val) return;
                patchRuntimeOptions((prev) => {
                  const normalised = normaliseRuntimeOptions(prev, 'devs-ai-v2');
                  return {
                    ...normalised,
                    devs_ai_v2: {
                      ...normalised.devs_ai_v2,
                      chat_mode: val as 'execute' | 'chat' | 'plan',
                    },
                  };
                });
              }}
            />
            <Select
              label="Thread mode"
              size="xs"
              data={[...DEVS_AI_V2_THREAD_MODE_OPTIONS]}
              value={normaliseRuntimeOptions(runtimeOptions, 'devs-ai-v2').devs_ai_v2.thread_mode}
              onChange={(val) => {
                if (!val) return;
                patchRuntimeOptions((prev) => {
                  const normalised = normaliseRuntimeOptions(prev, 'devs-ai-v2');
                  return {
                    ...normalised,
                    devs_ai_v2: {
                      ...normalised.devs_ai_v2,
                      thread_mode: val as 'collect' | 'steer' | 'interrupt' | 'force',
                    },
                  };
                });
              }}
            />
            <Switch
              size="sm"
              label="Parallel Tool Calls"
              checked={normaliseRuntimeOptions(runtimeOptions, 'devs-ai-v2').devs_ai_v2.parallel_tool_calls}
              onChange={(e) => {
                const checked = e.currentTarget.checked;
                patchRuntimeOptions((prev) => {
                  const normalised = normaliseRuntimeOptions(prev, 'devs-ai-v2');
                  return {
                    ...normalised,
                    devs_ai_v2: {
                      ...normalised.devs_ai_v2,
                      parallel_tool_calls: checked,
                    },
                  };
                });
              }}
            />
          </Stack>
        </Paper>
      )}

      {selectedProviderType === 'google-gemini' && (
        <Paper withBorder p="sm" radius="sm">
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              Google Gemini Runtime Options
            </Text>
            <Text size="xs" c="dimmed">
              Grounding with Google Search allows the model to retrieve web results when needed.
            </Text>
            <Switch
              size="sm"
              label="Grounding with Google Search"
              checked={normaliseRuntimeOptions(runtimeOptions).google_gemini.grounding_with_google_search}
              onChange={(e) => {
                const checked = e.currentTarget.checked;
                patchRuntimeOptions((prev) => {
                  const normalised = normaliseRuntimeOptions(prev);
                  return {
                    ...normalised,
                    google_gemini: {
                      ...normalised.google_gemini,
                      grounding_with_google_search: checked,
                    },
                  };
                });
              }}
            />
          </Stack>
        </Paper>
      )}
    </>
  );
}
