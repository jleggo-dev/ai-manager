import { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  Stack,
  Group,
  Text,
  Select,
  TextInput,
  Button,
  Paper,
  Badge,
  Alert,
  Switch,
  SegmentedControl,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconArrowsShuffle, IconTrash } from '@tabler/icons-react';
import * as api from '../../services/api';
import {
  type RuntimeOptions,
  DEVS_AI_BUILTIN_TOOL_OPTIONS,
  DEFAULT_RUNTIME_OPTIONS,
  normaliseRuntimeOptions,
} from '../../lib/runtime-options';
import type { AiProfile, Provider, LlmModel } from '../../types/api';

interface ProviderAi {
  id?: string;
  aiId?: string;
  name?: string;
}

interface FailoverConfigModalProps {
  opened: boolean;
  onClose: () => void;
  profile: AiProfile | null;
  providers: Provider[];
  onSaved?: () => void;
}

export default function FailoverConfigModal({
  opened,
  onClose,
  profile,
  providers,
  onSaved,
}: FailoverConfigModalProps) {
  const [failoverProviderId, setFailoverProviderId] = useState('');
  const [failoverAiId, setFailoverAiId] = useState('');
  const [profileType, setProfileType] = useState('agent');
  const [runtimeOptions, setRuntimeOptions] = useState<RuntimeOptions>(DEFAULT_RUNTIME_OPTIONS);
  const [saving, setSaving] = useState(false);

  const [availableAis, setAvailableAis] = useState<ProviderAi[]>([]);
  const [availableModels, setAvailableModels] = useState<LlmModel[]>([]);
  const [loadingAis, setLoadingAis] = useState(false);

  const resetForm = useCallback(() => {
    const fpId = profile?.failover_provider_id || '';
    const faId = profile?.failover_external_ai_id || '';
    setFailoverProviderId(fpId);
    setFailoverAiId(faId);

    const foRt = profile?.failover_runtime_options;
    if (foRt && typeof foRt === 'object') {
      setRuntimeOptions(normaliseRuntimeOptions(foRt));
    } else {
      setRuntimeOptions(normaliseRuntimeOptions(DEFAULT_RUNTIME_OPTIONS));
    }

    if (fpId) {
      const fp = providers.find((p) => p.id === fpId);
      if (fp?.type === 'google-gemini') {
        setProfileType('model');
      } else {
        setProfileType('agent');
      }
    } else {
      setProfileType('agent');
    }
  }, [profile, providers]);

  useEffect(() => {
    if (opened) resetForm();
  }, [opened, resetForm]);

  const selectedProvider = providers.find((p) => p.id === failoverProviderId);
  const selectedProviderType = selectedProvider?.type || '';
  const isGemini = selectedProviderType === 'google-gemini';
  const isModelOnlyProvider = isGemini;

  useEffect(() => {
    if (!failoverProviderId) {
      setAvailableAis([]);
      setAvailableModels([]);
      return;
    }
    let cancelled = false;
    setLoadingAis(true);

    if (isGemini) {
      setAvailableAis([]);
      api
        .listProviderModels(failoverProviderId)
        .then((models: LlmModel[]) => {
          if (!cancelled) setAvailableModels(Array.isArray(models) ? models : []);
        })
        .catch(() => {
          if (!cancelled) setAvailableModels([]);
        })
        .finally(() => {
          if (!cancelled) setLoadingAis(false);
        });
    } else if (profileType === 'agent') {
      setAvailableModels([]);
      api
        .listProviderAis(failoverProviderId)
        .then((ais: ProviderAi[]) => {
          if (!cancelled) setAvailableAis(Array.isArray(ais) ? ais : []);
        })
        .catch(() => {
          if (!cancelled) setAvailableAis([]);
        })
        .finally(() => {
          if (!cancelled) setLoadingAis(false);
        });
    } else {
      setAvailableAis([]);
      api
        .listProviderModels(failoverProviderId)
        .then((models: LlmModel[]) => {
          if (!cancelled) setAvailableModels(Array.isArray(models) ? models : []);
        })
        .catch(() => {
          if (!cancelled) setAvailableModels([]);
        })
        .finally(() => {
          if (!cancelled) setLoadingAis(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [failoverProviderId, isGemini, profileType]);

  const aiOptions = availableAis.map((ai) => ({
    value: ai.id || ai.aiId || String(ai),
    label: ai.name || ai.id || String(ai),
  }));

  const modelOptions = (() => {
    const active = availableModels.filter((m) => m.is_active);
    const groups: Record<string, { value: string; label: string }[]> = {};
    for (const m of active) {
      const g = m.category || 'Other';
      if (!groups[g]) groups[g] = [];
      groups[g].push({ value: m.model_id, label: m.display_name || m.model_id });
    }
    return Object.entries(groups).map(([group, items]) => ({ group, items }));
  })();

  const providerOptions = providers.map((p) => ({ value: p.id, label: `${p.name} (${p.type})` }));

  function handleProviderChange(providerId: string | null) {
    const pt = providers.find((p) => p.id === providerId)?.type || '';
    setFailoverProviderId(providerId || '');
    setFailoverAiId('');
    if (pt === 'google-gemini') {
      setProfileType('model');
    }
  }

  function handleProfileTypeChange(type: string) {
    setProfileType(type);
    setFailoverAiId('');
  }

  function toggleDevsAiTool(toolKey: string, enabled: boolean) {
    setRuntimeOptions((prev) => {
      const n = normaliseRuntimeOptions(prev);
      const currentTools = n.devs_ai.built_in_tools;
      const nextTools = enabled ? [...new Set([...currentTools, toolKey])] : currentTools.filter((t) => t !== toolKey);
      return { ...n, devs_ai: { ...n.devs_ai, built_in_tools: nextTools } };
    });
  }

  function updateDevsAiOption(key: string, value: boolean) {
    setRuntimeOptions((prev) => {
      const n = normaliseRuntimeOptions(prev);
      return { ...n, devs_ai: { ...n.devs_ai, [key]: value } };
    });
  }

  function updateGeminiOption(key: string, value: boolean) {
    setRuntimeOptions((prev) => {
      const n = normaliseRuntimeOptions(prev);
      return { ...n, google_gemini: { ...n.google_gemini, [key]: value } };
    });
  }

  async function handleSave() {
    if (!failoverProviderId || !failoverAiId) {
      notifications.show({
        title: 'Validation',
        message: 'Select both a provider and an agent/model',
        color: 'orange',
      });
      return;
    }
    if (!profile) return;
    try {
      setSaving(true);
      await api.updateAiProfile(profile.id, {
        failover_provider_id: failoverProviderId,
        failover_external_ai_id: failoverAiId,
        failover_runtime_options: normaliseRuntimeOptions(runtimeOptions),
      });
      notifications.show({ title: 'Failover Saved', message: 'Failover configuration updated', color: 'green' });
      onSaved?.();
      onClose();
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!profile) return;
    try {
      setSaving(true);
      await api.updateAiProfile(profile.id, {
        failover_provider_id: null,
        failover_external_ai_id: null,
        failover_runtime_options: null,
      });
      notifications.show({ title: 'Failover Cleared', message: 'Failover configuration removed', color: 'gray' });
      onSaved?.();
      onClose();
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  const primaryProviderName = profile?.provider?.name || 'Unknown';
  const primaryModel = profile?.external_ai_id || 'Unknown';
  const normRt = normaliseRuntimeOptions(runtimeOptions);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconArrowsShuffle size={18} color="var(--mantine-color-orange-6)" />
          <Text fw={600} c="orange.7">
            Configure Failover
          </Text>
        </Group>
      }
      size="lg"
      styles={{
        content: { borderTop: '3px solid var(--mantine-color-orange-5)' },
      }}
    >
      <Stack gap="sm">
        <Paper withBorder p="xs" bg="gray.0">
          <Text size="xs" fw={600} mb={4}>
            Primary Configuration
          </Text>
          <Group gap="lg">
            <div>
              <Text size="10" c="dimmed">
                Provider
              </Text>
              <Text size="xs" fw={500}>
                {primaryProviderName}
              </Text>
            </div>
            <div>
              <Text size="10" c="dimmed">
                Agent / Model
              </Text>
              <Text size="xs" fw={500}>
                <code>{primaryModel}</code>
              </Text>
            </div>
          </Group>
        </Paper>

        <Alert variant="light" color="orange" icon={<IconAlertTriangle size={14} />}>
          <Text size="xs">
            Failover activates automatically when the primary model fails or returns empty content. Configure a backup
            provider and agent/model below.
          </Text>
        </Alert>

        <SegmentedControl
          value={isModelOnlyProvider ? 'model' : profileType}
          onChange={handleProfileTypeChange}
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
          onChange={handleProviderChange}
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
              onChange={(v) => setFailoverAiId(v || '')}
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
              onChange={(e) => setFailoverAiId(e.target.value)}
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
              onChange={(v) => setFailoverAiId(v || '')}
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
              onChange={(e) => setFailoverAiId(e.target.value)}
              disabled={loadingAis}
            />
          ))}

        {failoverProviderId && selectedProviderType === 'devs-ai' && profileType === 'model' && (
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
                  onChange={(e) => toggleDevsAiTool(tool.key, e.currentTarget.checked)}
                />
              ))}
              <Switch
                size="sm"
                label="Generate Citations"
                color="orange"
                checked={normRt.devs_ai.generate_citations}
                onChange={(e) => updateDevsAiOption('generate_citations', e.currentTarget.checked)}
              />
              <Switch
                size="sm"
                label="Parallel Tool Calls"
                color="orange"
                checked={normRt.devs_ai.parallel_tool_calls}
                onChange={(e) => updateDevsAiOption('parallel_tool_calls', e.currentTarget.checked)}
              />
            </Stack>
          </Paper>
        )}

        {failoverProviderId && selectedProviderType === 'google-gemini' && (
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
                onChange={(e) => updateGeminiOption('grounding_with_google_search', e.currentTarget.checked)}
              />
            </Stack>
          </Paper>
        )}

        {profile?.failover_provider_id && (
          <Paper withBorder p="xs" bg="orange.0">
            <Group gap="xs">
              <Badge size="xs" color="orange" variant="light">
                Current Failover
              </Badge>
              <Text size="xs">
                {profile.failover_provider?.name || 'Unknown provider'} — <code>{profile.failover_external_ai_id}</code>
              </Text>
            </Group>
          </Paper>
        )}

        <Group justify="space-between" mt="sm">
          <Button
            variant="subtle"
            color="red"
            size="xs"
            leftSection={<IconTrash size={14} />}
            onClick={handleClear}
            loading={saving}
            disabled={!profile?.failover_provider_id}
          >
            Clear Failover
          </Button>
          <Group gap="xs">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button
              color="orange"
              onClick={handleSave}
              loading={saving}
              disabled={!failoverProviderId || !failoverAiId}
            >
              Save Failover
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
