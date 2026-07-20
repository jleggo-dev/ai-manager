import { useState, useEffect, useCallback } from 'react';
import { notifications } from '@mantine/notifications';
import * as api from '../../../services/api';
import { type RuntimeOptions, DEFAULT_RUNTIME_OPTIONS, normaliseRuntimeOptions } from '../../../lib/runtime-options';
import type { AiProfile, Provider, LlmModel } from '../../../types/api';
import { buildModelOptions, mapAiOptions, type ProviderAi } from './failoverFormOptions';

interface UseFailoverConfigFormArgs {
  opened: boolean;
  profile: AiProfile | null;
  providers: Provider[];
  onSaved?: () => void;
  onClose: () => void;
}

function loadProviderCatalog(
  providerId: string,
  isGemini: boolean,
  profileType: string,
  setAvailableAis: (ais: ProviderAi[]) => void,
  setAvailableModels: (models: LlmModel[]) => void,
  setLoadingAis: (loading: boolean) => void,
): () => void {
  let cancelled = false;
  setLoadingAis(true);

  if (isGemini) {
    setAvailableAis([]);
    api
      .listProviderModels(providerId)
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
      .listProviderAis(providerId)
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
      .listProviderModels(providerId)
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
}

export function useFailoverConfigForm({ opened, profile, providers, onSaved, onClose }: UseFailoverConfigFormArgs) {
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
    setFailoverProviderId(fpId);
    setFailoverAiId(profile?.failover_external_ai_id || '');
    const foRt = profile?.failover_runtime_options;
    setRuntimeOptions(normaliseRuntimeOptions(foRt && typeof foRt === 'object' ? foRt : DEFAULT_RUNTIME_OPTIONS));
    if (fpId) {
      const fp = providers.find((p) => p.id === fpId);
      setProfileType(fp?.type === 'google-gemini' ? 'model' : 'agent');
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
    return loadProviderCatalog(
      failoverProviderId,
      isGemini,
      profileType,
      setAvailableAis,
      setAvailableModels,
      setLoadingAis,
    );
  }, [failoverProviderId, isGemini, profileType]);

  function handleProviderChange(providerId: string | null) {
    const pt = providers.find((p) => p.id === providerId)?.type || '';
    setFailoverProviderId(providerId || '');
    setFailoverAiId('');
    if (pt === 'google-gemini') setProfileType('model');
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

  return {
    failoverProviderId,
    failoverAiId,
    setFailoverAiId,
    profileType,
    runtimeOptions,
    saving,
    loadingAis,
    selectedProviderType,
    isModelOnlyProvider,
    aiOptions: mapAiOptions(availableAis),
    modelOptions: buildModelOptions(availableModels),
    providerOptions: providers.map((p) => ({ value: p.id, label: `${p.name} (${p.type})` })),
    handleProviderChange,
    handleProfileTypeChange,
    toggleDevsAiTool,
    updateDevsAiOption,
    updateGeminiOption,
    handleSave,
    handleClear,
  };
}
