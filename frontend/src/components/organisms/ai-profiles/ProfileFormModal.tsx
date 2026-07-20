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
 *
 * FE-14: form sections split into ProfileFormIdentityFields, ProfileFailoverSection,
 * and ProfileFormDetailsFields so this file stays under the max-lines gate.
 */

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Modal, Stack } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { type McpTool, type ToolAuthEntry } from './McpToolsPanel';
import JobsAsToolsPanel, { type ToolJobFormRow } from './JobsAsToolsPanel';
import ProfileFailoverSection from './ProfileFailoverSection';
import ProfileFormDetailsFields from './ProfileFormDetailsFields';
import ProfileFormIdentityFields, { type ProviderAi } from './ProfileFormIdentityFields';
import ProfileRuntimeOptions from './ProfileRuntimeOptions';
import * as api from '../../../services/api';
import type { AiProfile, LlmModel, Provider } from '../../../types/api';
import { DEFAULT_RUNTIME_OPTIONS, normaliseRuntimeOptions, type RuntimeOptions } from '../../../lib/runtime-options';
import { isModelOnlyProviderType } from '../../../lib/provider-types';

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

  function handleExternalAiChange(externalAiId: string, autoName?: string) {
    setForm((prev) => ({
      ...prev,
      external_ai_id: externalAiId,
      name: prev.name || autoName || '',
    }));
  }

  return (
    <Modal opened={modalOpened} onClose={closeModal} title={editing ? 'Edit AI Profile' : 'New AI Profile'} size="md">
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <ProfileFormIdentityFields
            editing={!!editing}
            isModelOnlyProvider={isModelOnlyProvider}
            profileType={profileType}
            onProfileTypeChange={handleProfileTypeChange}
            mode={mode}
            onModeChange={setMode}
            providerOptions={providerOptions}
            providerId={form.provider_id}
            onProviderChange={handleProviderChange}
            effectiveProfileType={effectiveProfileType}
            selectedProvider={selectedProvider}
            externalAiId={form.external_ai_id}
            availableAis={availableAis}
            availableModels={availableModels}
            onExternalAiChange={handleExternalAiChange}
          />

          <ProfileFailoverSection
            editing={editing}
            onConfigure={(profile) => {
              closeModal();
              onConfigureFailover(profile);
            }}
          />

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

          <ProfileFormDetailsFields
            editing={!!editing}
            saving={saving}
            effectiveProfileType={effectiveProfileType}
            name={form.name}
            description={form.description}
            isActive={form.is_active}
            onNameChange={(name) => setForm((prev) => ({ ...prev, name }))}
            onDescriptionChange={(description) => setForm((prev) => ({ ...prev, description }))}
            onActiveChange={(isActive) => setForm((prev) => ({ ...prev, is_active: isActive }))}
            onCancel={closeModal}
          />
        </Stack>
      </form>
    </Modal>
  );
});

export default ProfileFormModal;
