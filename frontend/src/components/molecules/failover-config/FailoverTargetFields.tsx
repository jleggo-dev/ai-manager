import { Text, Select, TextInput, SegmentedControl } from '@mantine/core';

interface SelectOption {
  value: string;
  label: string;
}

interface ModelGroup {
  group: string;
  items: SelectOption[];
}

interface FailoverTargetFieldsProps {
  isModelOnlyProvider: boolean;
  profileType: string;
  onProfileTypeChange: (type: string) => void;
  providerOptions: SelectOption[];
  failoverProviderId: string;
  onProviderChange: (providerId: string | null) => void;
  aiOptions: SelectOption[];
  modelOptions: ModelGroup[];
  failoverAiId: string;
  onAiIdChange: (id: string) => void;
  loadingAis: boolean;
}

export function FailoverTargetFields({
  isModelOnlyProvider,
  profileType,
  onProfileTypeChange,
  providerOptions,
  failoverProviderId,
  onProviderChange,
  aiOptions,
  modelOptions,
  failoverAiId,
  onAiIdChange,
  loadingAis,
}: FailoverTargetFieldsProps) {
  return (
    <>
      <SegmentedControl
        value={isModelOnlyProvider ? 'model' : profileType}
        onChange={onProfileTypeChange}
        data={[
          { label: 'AI Agent', value: 'agent' },
          { label: 'AI Model', value: 'model' },
        ]}
        disabled={isModelOnlyProvider}
        fullWidth
        color="orange"
      />

      <Text size="xs" c="dimmed">
        {isModelOnlyProvider
          ? 'Google Gemini uses model IDs directly (no provider-side agent objects).'
          : profileType === 'agent'
            ? 'AI Agents are Devs.ai-configured agents with custom instructions and knowledge.'
            : 'AI Models are raw LLM models accessed directly via model ID through the completions API.'}
      </Text>

      <Select
        label="Failover Provider"
        placeholder="Select a provider"
        data={providerOptions}
        value={failoverProviderId || null}
        onChange={onProviderChange}
        searchable
        clearable
      />

      {failoverProviderId &&
        profileType === 'agent' &&
        (aiOptions.length > 0 ? (
          <Select
            label="Available AI"
            placeholder={loadingAis ? 'Loading...' : 'Select an AI from the provider'}
            data={aiOptions}
            value={failoverAiId || null}
            onChange={(v) => onAiIdChange(v || '')}
            searchable
            clearable
            disabled={loadingAis}
            nothingFoundMessage={loadingAis ? 'Loading...' : 'No agents found'}
          />
        ) : (
          <TextInput
            label="External AI ID"
            placeholder="AI UUID or model name"
            value={failoverAiId}
            onChange={(e) => onAiIdChange(e.target.value)}
            disabled={loadingAis}
          />
        ))}

      {failoverProviderId &&
        profileType === 'model' &&
        (modelOptions.length > 0 ? (
          <Select
            label="LLM Model"
            placeholder={loadingAis ? 'Loading...' : 'Select a model'}
            data={modelOptions}
            value={failoverAiId || null}
            onChange={(v) => onAiIdChange(v || '')}
            searchable
            clearable
            disabled={loadingAis}
            nothingFoundMessage={loadingAis ? 'Loading...' : 'No models found'}
          />
        ) : (
          <TextInput
            label="Model ID"
            placeholder="e.g. gpt-5.2 or gemini-2.5-pro"
            value={failoverAiId}
            onChange={(e) => onAiIdChange(e.target.value)}
            disabled={loadingAis}
          />
        ))}
    </>
  );
}
