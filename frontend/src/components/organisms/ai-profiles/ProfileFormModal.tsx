/**
 * ai-profiles/ProfileFormModal
 * -----------------------------
 * The AI Profile create/edit modal: profile type + mode toggles, provider/AI/model
 * selection, per-provider runtime-option panels (Devs.ai, Devs.ai v2, Google Gemini),
 * jobs-as-tools config, and the failover summary/entry-point.
 *
 * Extracted from AiProfileManager.tsx (FE-02) as a structural, behavior-preserving
 * move — the modal's open/create/edit state and handlers moved here as-is, exposed
 * to the orchestrator via an imperative ref (openCreate / openEdit) so the parent
 * can keep owning the profiles list and the "Add AI Profile" / row "Edit" actions.
 */

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import {
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Select,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconArrowsShuffle } from '@tabler/icons-react';
import { type McpTool, type ToolAuthEntry } from './McpToolsPanel';
import JobsAsToolsPanel, { type ToolJobFormRow } from './JobsAsToolsPanel';
import ProfileRuntimeOptions from './ProfileRuntimeOptions';
import * as api from '../../../services/api';
import type { AiProfile, LlmModel, Provider } from '../../../types/api';
import { DEFAULT_RUNTIME_OPTIONS, normaliseRuntimeOptions, type RuntimeOptions } from '../../../lib/runtime-options';
import { isModelOnlyProviderType } from '../../../lib/provider-types';

interface ProviderAi {
  id?: string;
  aiId?: string;
  name?: string;
}

export interface ProfileFormModalHandle {
  openCreate: () => void;
  openEdit: (profile: AiProfile) => void;
}

interface ProfileFormModalProps {
  providers: Provider[];
  onSaved: () => void;
  onConfigureFailover: (profile: AiProfile) => void;
}

const ProfileFormModal = forwardRef<ProfileFormModalHandle, ProfileFormModalProps>(function ProfileFormModal(
  { providers, onSaved, onConfigureFailover },
  ref,
) {
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<AiProfile | null>(null);
  const [availableAis, setAvailableAis] = useState<ProviderAi[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  /* Profile type toggle: 'agent' or 'model' */
  const [profileType, setProfileType] = useState('agent');
  const [mode, setMode] = useState('completion');
  const [availableModels, setAvailableModels] = useState<LlmModel[]>([]);

  /* MCP tools state (fetched dynamically from Devs.ai for saved profiles) */
  const [mcpTools, setMcpTools] = useState<McpTool[]>([]);
  const [toolAuthStatus, setToolAuthStatus] = useState<ToolAuthEntry[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [processingJobs, setProcessingJobs] = useState<Array<{ slug: string; name: string }>>([]);
  const [toolJobs, setToolJobs] = useState<ToolJobFormRow[]>([]);

  /* Form state */
  const [form, setForm] = useState({
    provider_id: '',
    external_ai_id: '',
    name: '',
    description: '',
    is_active: true,
    runtime_options: DEFAULT_RUNTIME_OPTIONS,
  });

  useEffect(() => {
    if (!modalOpened) return;
    api
      .listProcessingJobs({ limit: 200 })
      .then((result) => {
        setProcessingJobs(
          (result.data || []).map((j) => ({ slug: j.slug, name: j.name })).filter((j) => Boolean(j.slug)),
        );
      })
      .catch(() => setProcessingJobs([]));
  }, [modalOpened]);

  /* Fetch AIs or models whenever provider or profile type changes */
  useEffect(() => {
    if (!selectedProvider) {
      setAvailableAis([]);
      setAvailableModels([]);
      return;
    }

    let cancelled = false;

    const providerType = providers.find((p) => p.id === selectedProvider)?.type || '';

    const useModelList = isModelOnlyProviderType(providerType) || profileType === 'model';

    if (useModelList) {
      setAvailableAis([]);
      api
        .listProviderModels(selectedProvider)
        .then((models) => {
          if (!cancelled) setAvailableModels(Array.isArray(models) ? models : []);
        })
        .catch(() => {
          if (!cancelled) {
            setAvailableModels([]);
            notifications.show({
              title: 'Warning',
              message: 'Could not fetch models from provider',
              color: 'yellow',
            });
          }
        });
      return () => {
        cancelled = true;
      };
    }

    if (profileType === 'agent') {
      setAvailableModels([]);
      api
        .listProviderAis(selectedProvider)
        .then((ais) => {
          if (!cancelled) setAvailableAis(Array.isArray(ais) ? ais : []);
        })
        .catch(() => {
          if (!cancelled) {
            setAvailableAis([]);
            notifications.show({
              title: 'Warning',
              message: 'Could not fetch AIs from provider',
              color: 'yellow',
            });
          }
        });
    } else {
      setAvailableAis([]);
      api
        .listProviderModels(selectedProvider)
        .then((models) => {
          if (!cancelled) setAvailableModels(Array.isArray(models) ? models : []);
        })
        .catch(() => {
          if (!cancelled) {
            setAvailableModels([]);
            notifications.show({
              title: 'Warning',
              message: 'Could not fetch models from provider',
              color: 'yellow',
            });
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [selectedProvider, profileType, providers]);

  /* When provider changes, update state and clear external_ai_id */
  function handleProviderChange(providerId: string | null) {
    const providerType = providers.find((p) => p.id === providerId)?.type || '';
    const modelOnly = isModelOnlyProviderType(providerType);
    if (modelOnly && profileType !== 'model') {
      setProfileType('model');
      const providerLabel = providers.find((p) => p.id === providerId)?.name || providerType;
      notifications.show({
        title: 'Model-only Provider',
        message: `${providerLabel} profiles use model mode only.`,
        color: 'blue',
      });
    }
    setSelectedProvider(providerId);
    setForm((prev) => ({
      ...prev,
      provider_id: providerId || '',
      external_ai_id: '',
    }));
  }

  /* When profile type toggles, update state and clear external_ai_id */
  function handleProfileTypeChange(type: string) {
    setProfileType(type);
    setForm((prev) => ({ ...prev, external_ai_id: '' }));
  }

  function openCreate() {
    setEditing(null);
    setProfileType('agent');
    setMode('completion');
    setMcpTools([]);
    setToolAuthStatus([]);
    setForm({
      provider_id: '',
      external_ai_id: '',
      name: '',
      description: '',
      is_active: true,
      runtime_options: DEFAULT_RUNTIME_OPTIONS,
    });
    setToolJobs([]);
    setAvailableAis([]);
    setAvailableModels([]);
    setSelectedProvider(null);
    openModal();
  }

  async function loadMcpTools(profileId: string, providerType: string) {
    if (providerType !== 'devs-ai') {
      setMcpTools([]);
      setToolAuthStatus([]);
      return;
    }
    setMcpLoading(true);
    try {
      const [tools, authStatus] = await Promise.all([
        api.listProfileTools(profileId).catch((): McpTool[] => []),
        api.listProfileToolAuthStatus(profileId).catch((): ToolAuthEntry[] => []),
      ]);
      const allTools: McpTool[] = Array.isArray(tools) ? tools : [];
      const mcpOnly = allTools.filter((t) => t.type === 'MCP_SERVER');
      setMcpTools(mcpOnly);
      setToolAuthStatus(Array.isArray(authStatus) ? authStatus : []);
    } catch {
      setMcpTools([]);
      setToolAuthStatus([]);
    } finally {
      setMcpLoading(false);
    }
  }

  function openEdit(profile: AiProfile) {
    setEditing(profile);
    const resolvedProviderId = profile.provider_id || profile.provider?.id || '';
    const resolvedProviderType =
      providers.find((p) => p.id === resolvedProviderId)?.type || profile.provider?.type || '';
    setProfileType(isModelOnlyProviderType(resolvedProviderType) ? 'model' : profile.profile_type || 'agent');
    setMode(profile.mode || 'completion');
    setSelectedProvider(resolvedProviderId || null);
    setForm({
      provider_id: resolvedProviderId,
      external_ai_id: profile.external_ai_id || '',
      name: profile.name || '',
      description: profile.description || '',
      is_active: profile.is_active !== false,
      runtime_options: normaliseRuntimeOptions(profile.runtime_options),
    });
    const cfg = (profile.config || {}) as { toolJobs?: ToolJobFormRow[] };
    setToolJobs(
      Array.isArray(cfg.toolJobs)
        ? cfg.toolJobs.map((t) => ({
            jobSlug: t.jobSlug || '',
            exposeAs: t.exposeAs || '',
            description: t.description || '',
          }))
        : [],
    );
    setMcpTools([]);
    setToolAuthStatus([]);
    loadMcpTools(profile.id, resolvedProviderType);
    openModal();
  }

  useImperativeHandle(ref, () => ({ openCreate, openEdit }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      setSaving(true);
      const providerType = providers.find((p) => p.id === form.provider_id)?.type || '';
      const payload: Record<string, unknown> = {
        ...form,
        profile_type: isModelOnlyProviderType(providerType) ? 'model' : profileType,
        mode,
        runtime_options: normaliseRuntimeOptions(form.runtime_options),
      };
      if (mode === 'chat') {
        const priorConfig = (editing?.config as Record<string, unknown> | undefined) || {};
        payload.config = {
          ...priorConfig,
          toolJobs: toolJobs.filter((t) => t.jobSlug.trim() && t.exposeAs.trim()),
        };
      }
      if (editing) {
        await api.updateAiProfile(editing.id, payload);
        notifications.show({
          title: 'Updated',
          message: 'AI profile updated',
          color: 'green',
        });
      } else {
        await api.createAiProfile(payload);
        notifications.show({
          title: 'Created',
          message: 'AI profile created',
          color: 'green',
        });
      }
      closeModal();
      await onSaved();
    } catch (err: unknown) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  }

  const selectedProviderType = providers.find((p) => p.id === form.provider_id)?.type || '';
  const isModelOnlyProvider = isModelOnlyProviderType(selectedProviderType);
  const effectiveProfileType = isModelOnlyProvider ? 'model' : profileType;

  /* Build select options from available AIs (Devs.ai format) */
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

  const providerOptions = providers.map((p) => ({
    value: p.id,
    label: `${p.name} (${p.type})`,
  }));

  function patchRuntimeOptions(updater: (prev: RuntimeOptions) => RuntimeOptions) {
    setForm((prev) => ({
      ...prev,
      runtime_options: updater(normaliseRuntimeOptions(prev.runtime_options)),
    }));
  }

  return (
    <Modal opened={modalOpened} onClose={closeModal} title={editing ? 'Edit AI Profile' : 'New AI Profile'} size="md">
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          {/* Profile type toggle — Agent vs Model */}
          <SegmentedControl
            value={isModelOnlyProvider ? 'model' : profileType}
            onChange={handleProfileTypeChange}
            data={[
              { label: 'AI Agent', value: 'agent' },
              { label: 'AI Model', value: 'model' },
            ]}
            disabled={!!editing || isModelOnlyProvider}
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
            onChange={setMode}
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
            value={form.provider_id}
            onChange={handleProviderChange}
            required
            disabled={!!editing}
          />

          {/* Agent mode: show AI select or manual input */}
          {effectiveProfileType === 'agent' &&
            (aiOptions.length > 0 ? (
              <Select
                label="Available AI"
                placeholder="Select an AI from the provider"
                data={aiOptions}
                value={form.external_ai_id}
                onChange={(v) => {
                  const ai = availableAis.find((a) => (a.id || a.aiId) === v);
                  setForm((prev) => ({
                    ...prev,
                    external_ai_id: v || '',
                    name: prev.name || ai?.name || '',
                  }));
                }}
                searchable
              />
            ) : (
              <TextInput
                label="External AI ID"
                placeholder="AI UUID or model name"
                value={form.external_ai_id}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    external_ai_id: e.target.value,
                  }))
                }
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
                value={form.external_ai_id}
                onChange={(v) => {
                  const model = availableModels.find((m) => m.model_id === v);
                  setForm((prev) => ({
                    ...prev,
                    external_ai_id: v || '',
                    name: prev.name || model?.display_name || '',
                  }));
                }}
                searchable
              />
            ) : (
              <TextInput
                label="Model ID"
                placeholder="e.g. gpt-5.2 or anthropic-claude-4-sonnet"
                value={form.external_ai_id}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    external_ai_id: e.target.value,
                  }))
                }
                required
              />
            ))}

          {!form.external_ai_id && selectedProvider && effectiveProfileType === 'agent' && (
            <Text size="xs" c="dimmed">
              If the provider list is empty, enter the AI ID manually above.
            </Text>
          )}

          {!form.external_ai_id &&
            selectedProvider &&
            effectiveProfileType === 'model' &&
            availableModels.length === 0 && (
              <Text size="xs" c="dimmed">
                No models registered for this provider. Use &quot;Manage LLMs&quot; to add models, or enter a model ID
                manually.
              </Text>
            )}

          <Paper withBorder p="sm" radius="sm" style={{ borderLeft: '3px solid var(--mantine-color-orange-5)' }}>
            <Stack gap="xs">
              <Text size="sm" fw={600} c="orange.7">
                Failover (optional)
              </Text>
              <Text size="xs" c="dimmed">
                Failover activates when the primary model fails or returns empty content.
              </Text>
              {editing?.failover_provider && (
                <Group gap="xs">
                  <Badge size="xs" color="orange" variant="light">
                    Active
                  </Badge>
                  <Text size="xs">
                    {editing.failover_provider.name} — <code>{editing.failover_external_ai_id}</code>
                  </Text>
                </Group>
              )}
              {editing ? (
                <Button
                  variant="light"
                  color="orange"
                  size="xs"
                  leftSection={<IconArrowsShuffle size={14} />}
                  onClick={() => {
                    closeModal();
                    onConfigureFailover(editing);
                  }}
                >
                  {editing.failover_provider_id ? 'Edit Failover' : 'Configure Failover'}
                </Button>
              ) : (
                <Text size="xs" c="dimmed" fs="italic">
                  Save the profile first, then configure failover.
                </Text>
              )}
            </Stack>
          </Paper>

          <ProfileRuntimeOptions
            selectedProviderType={selectedProviderType}
            effectiveProfileType={effectiveProfileType}
            runtimeOptions={form.runtime_options}
            patchRuntimeOptions={patchRuntimeOptions}
            editing={editing}
            mcpTools={mcpTools}
            toolAuthStatus={toolAuthStatus}
            mcpLoading={mcpLoading}
            onRefreshMcp={(profileId) => loadMcpTools(profileId, 'devs-ai')}
          />

          {mode === 'chat' && (
            <JobsAsToolsPanel toolJobs={toolJobs} setToolJobs={setToolJobs} processingJobs={processingJobs} />
          )}

          <TextInput
            data-testid="profile-name-input"
            label="Profile Name"
            placeholder={effectiveProfileType === 'agent' ? 'e.g. GPT-5.2 Generic' : 'e.g. Claude 4 Sonnet'}
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            required
          />
          <Textarea
            label="Description (optional)"
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            minRows={2}
          />
          <Switch
            label="Active"
            checked={form.is_active}
            onChange={(e) => {
              const v = e.currentTarget.checked;
              setForm((prev) => ({ ...prev, is_active: v }));
            }}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? 'Update' : 'Create'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
});

export default ProfileFormModal;
