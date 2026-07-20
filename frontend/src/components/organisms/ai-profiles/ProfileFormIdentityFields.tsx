/**
 * ai-profiles/ProfileFormIdentityFields
 * -------------------------------------
 * Profile type / mode toggles, provider select, and agent-or-model identity fields
 * inside the profile form modal.
 * Extracted from ProfileFormModal (FE-14) as a structural, behavior-preserving move.
 */

import { Select, SegmentedControl, Text, TextInput } from '@mantine/core';
import type { LlmModel } from '../../../types/api';

export interface ProviderAi {
  id?: string;
  aiId?: string;
  name?: string;
}

interface ProfileFormIdentityFieldsProps {
  editing: boolean;
  isModelOnlyProvider: boolean;
  profileType: string;
  onProfileTypeChange: (type: string) => void;
  mode: string;
  onModeChange: (mode: string) => void;
  providerOptions: Array<{ value: string; label: string }>;
  providerId: string;
  onProviderChange: (providerId: string | null) => void;
  effectiveProfileType: string;
  selectedProvider: string | null;
  externalAiId: string;
  availableAis: ProviderAi[];
  availableModels: LlmModel[];
  onExternalAiChange: (externalAiId: string, autoName?: string) => void;
}

export default function ProfileFormIdentityFields({
  editing,
  isModelOnlyProvider,
  profileType,
  onProfileTypeChange,
  mode,
  onModeChange,
  providerOptions,
  providerId,
  onProviderChange,
  effectiveProfileType,
  selectedProvider,
  externalAiId,
  availableAis,
  availableModels,
  onExternalAiChange,
}: ProfileFormIdentityFieldsProps) {
  const aiOptions = availableAis.map((ai) => ({
    value: ai.id || ai.aiId || String(ai),
    label: ai.name || ai.id || String(ai),
  }));

  /* Build select options from registered LLM models, grouped by category.
     Mantine v7 expects grouped data as { group, items } objects. */
  const modelOptions = (() => {
    const activeModels = availableModels.filter((m) => m.is_active);
    const groups: Record<string, { value: string; label: string }[]> = {};
    for (const m of activeModels) {
      const g = m.category || 'Other';
      if (!groups[g]) groups[g] = [];
      groups[g].push({
        value: m.model_id,
        label: m.display_name || m.model_id,
      });
    }
    return Object.entries(groups).map(([group, items]) => ({ group, items }));
  })();

  return (
    <>
      {/* Profile type toggle — Agent vs Model */}
      <SegmentedControl
        value={isModelOnlyProvider ? 'model' : profileType}
        onChange={onProfileTypeChange}
        data={[
          { label: 'AI Agent', value: 'agent' },
          { label: 'AI Model', value: 'model' },
        ]}
        disabled={editing || isModelOnlyProvider}
        fullWidth
      />

      <Text size="xs" c="dimmed">
        {isModelOnlyProvider
          ? 'Google Gemini uses model IDs directly (no provider-side agent objects).'
          : profileType === 'agent'
            ? 'AI Agents are Devs.ai-configured agents with custom instructions and knowledge.'
            : 'AI Models are raw LLM models accessed directly via model ID through the completions API.'}
      </Text>

      <SegmentedControl
        value={mode}
        onChange={onModeChange}
        data={[
          { label: 'Completion', value: 'completion' },
          { label: 'Chat', value: 'chat' },
        ]}
        fullWidth
      />
      <Text size="xs" c="dimmed">
        {mode === 'chat'
          ? 'Chat mode uses streaming responses for real-time interaction.'
          : 'Completion mode returns the full response in a single request.'}
      </Text>

      <Select
        data-testid="profile-provider-select"
        label="Provider"
        placeholder="Select a provider"
        data={providerOptions}
        value={providerId}
        onChange={onProviderChange}
        required
        disabled={editing}
      />

      {/* Agent mode: show AI select or manual input */}
      {effectiveProfileType === 'agent' &&
        (aiOptions.length > 0 ? (
          <Select
            label="Available AI"
            placeholder="Select an AI from the provider"
            data={aiOptions}
            value={externalAiId}
            onChange={(v) => {
              const ai = availableAis.find((a) => (a.id || a.aiId) === v);
              onExternalAiChange(v || '', ai?.name);
            }}
            searchable
          />
        ) : (
          <TextInput
            label="External AI ID"
            placeholder="AI UUID or model name"
            value={externalAiId}
            onChange={(e) => onExternalAiChange(e.target.value)}
            required
          />
        ))}

      {/* Model mode: show model select from registered models */}
      {effectiveProfileType === 'model' &&
        (modelOptions.length > 0 ? (
          <Select
            data-testid="profile-model-select"
            label="LLM Model"
            placeholder="Select a model"
            data={modelOptions}
            value={externalAiId}
            onChange={(v) => {
              const model = availableModels.find((m) => m.model_id === v);
              onExternalAiChange(v || '', model?.display_name);
            }}
            searchable
          />
        ) : (
          <TextInput
            label="Model ID"
            placeholder="e.g. gpt-5.2 or anthropic-claude-4-sonnet"
            value={externalAiId}
            onChange={(e) => onExternalAiChange(e.target.value)}
            required
          />
        ))}

      {!externalAiId && selectedProvider && effectiveProfileType === 'agent' && (
        <Text size="xs" c="dimmed">
          If the provider list is empty, enter the AI ID manually above.
        </Text>
      )}

      {!externalAiId && selectedProvider && effectiveProfileType === 'model' && availableModels.length === 0 && (
        <Text size="xs" c="dimmed">
          No models registered for this provider. Use &quot;Manage LLMs&quot; to add models, or enter a model ID
          manually.
        </Text>
      )}
    </>
  );
}
