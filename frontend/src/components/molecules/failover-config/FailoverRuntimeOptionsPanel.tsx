import { Stack, Text, Paper, Switch } from '@mantine/core';
import {
  type RuntimeOptions,
  DEVS_AI_BUILTIN_TOOL_OPTIONS,
  normaliseRuntimeOptions,
} from '../../../lib/runtime-options';

interface FailoverRuntimeOptionsPanelProps {
  providerType: string;
  profileType: string;
  runtimeOptions: RuntimeOptions;
  onToggleDevsAiTool: (toolKey: string, enabled: boolean) => void;
  onUpdateDevsAiOption: (key: string, value: boolean) => void;
  onUpdateGeminiOption: (key: string, value: boolean) => void;
}

export function FailoverRuntimeOptionsPanel({
  providerType,
  profileType,
  runtimeOptions,
  onToggleDevsAiTool,
  onUpdateDevsAiOption,
  onUpdateGeminiOption,
}: FailoverRuntimeOptionsPanelProps) {
  const normRt = normaliseRuntimeOptions(runtimeOptions);

  if (providerType === 'devs-ai' && profileType === 'model') {
    return (
      <Paper withBorder p="sm" radius="sm" style={{ borderLeft: '3px solid var(--mantine-color-orange-4)' }}>
        <Stack gap="xs">
          <Text size="sm" fw={600} c="orange.7">
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
              color="orange"
              checked={normRt.devs_ai.built_in_tools.includes(tool.key)}
              onChange={(e) => onToggleDevsAiTool(tool.key, e.currentTarget.checked)}
            />
          ))}
          <Switch
            size="sm"
            label="Generate Citations"
            color="orange"
            checked={normRt.devs_ai.generate_citations}
            onChange={(e) => onUpdateDevsAiOption('generate_citations', e.currentTarget.checked)}
          />
          <Switch
            size="sm"
            label="Parallel Tool Calls"
            color="orange"
            checked={normRt.devs_ai.parallel_tool_calls}
            onChange={(e) => onUpdateDevsAiOption('parallel_tool_calls', e.currentTarget.checked)}
          />
        </Stack>
      </Paper>
    );
  }

  if (providerType === 'google-gemini') {
    return (
      <Paper withBorder p="sm" radius="sm" style={{ borderLeft: '3px solid var(--mantine-color-orange-4)' }}>
        <Stack gap="xs">
          <Text size="sm" fw={600} c="orange.7">
            Google Gemini Runtime Options
          </Text>
          <Text size="xs" c="dimmed">
            Grounding with Google Search allows the model to retrieve web results when needed.
          </Text>
          <Switch
            size="sm"
            label="Grounding with Google Search"
            color="orange"
            checked={normRt.google_gemini.grounding_with_google_search}
            onChange={(e) => onUpdateGeminiOption('grounding_with_google_search', e.currentTarget.checked)}
          />
        </Stack>
      </Paper>
    );
  }

  return null;
}
