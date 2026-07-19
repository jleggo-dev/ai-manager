/**
 * useHealthCheckProfilesData
 * -----------------------------
 * Owns Health Check Profiles list CRUD, form state, provider-key auto-resolve,
 * and agent/model option fetching. Extracted from HealthCheckProfilesPage.tsx
 * (FE-08) as a structural, behavior-preserving move.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import * as api from '../services/api';
import type { HcProfile, Provider, HcProviderKey, LlmModel } from '../types/api';
import {
  buildAiOptions,
  buildModelOptions,
  filterEligibleProviders,
  filterKeysForProvider,
  isModelOnlyProviderType,
  resolveProviderName,
  type ProviderAi,
} from '../lib/health-check-profiles';

export interface ProfileFormState {
  name: string;
  provider_id: string;
  hc_provider_key_id: string;
  external_ai_id: string;
  mode: string;
  profile_type: string;
  description: string;
  is_active: boolean;
}

export const EMPTY_PROFILE_FORM: ProfileFormState = {
  name: '',
  provider_id: '',
  hc_provider_key_id: '',
  external_ai_id: '',
  mode: 'completion',
  profile_type: 'agent',
  description: '',
  is_active: true,
};

export function useHealthCheckProfilesData() {
  const [profiles, setProfiles] = useState<HcProfile[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerKeys, setProviderKeys] = useState<HcProviderKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<HcProfile | null>(null);
  const [form, setForm] = useState<ProfileFormState>(EMPTY_PROFILE_FORM);
  const [formOpened, { open: openForm, close: closeForm }] = useDisclosure(false);
  const [deleteTarget, setDeleteTarget] = useState<HcProfile | null>(null);
  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);

  const [availableAis, setAvailableAis] = useState<ProviderAi[]>([]);
  const [availableModels, setAvailableModels] = useState<LlmModel[]>([]);
  const [profileType, setProfileType] = useState<'agent' | 'model'>('agent');
  const [fetchingAis, setFetchingAis] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [manualIdEntry, setManualIdEntry] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [profileRes, providerRes, keyRes] = await Promise.all([
        api.listHcProfiles(),
        api.listProviders(),
        api.listHcProviderKeys(),
      ]);
      setProfiles(profileRes.data);
      setProviders(providerRes.data);
      setProviderKeys(keyRes.data);
    } catch (err: unknown) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const eligibleProviders = useMemo(() => filterEligibleProviders(providers, providerKeys), [providers, providerKeys]);

  const filteredKeys = useMemo(
    () => filterKeysForProvider(providerKeys, form.provider_id),
    [providerKeys, form.provider_id],
  );

  const selectedProviderType = providers.find((p) => p.id === form.provider_id)?.type ?? '';
  const isModelOnlyProvider = isModelOnlyProviderType(selectedProviderType);

  /* Fetch agents/models whenever provider or profileType changes */
  useEffect(() => {
    if (!form.provider_id) {
      setAvailableAis([]);
      setAvailableModels([]);
      return;
    }

    let cancelled = false;
    setFetchingAis(true);

    const effectiveType = isModelOnlyProvider ? 'model' : profileType;

    if (effectiveType === 'agent') {
      setAvailableModels([]);
      api
        .listProviderAis(form.provider_id)
        .then((ais) => {
          if (!cancelled) {
            const isList = Array.isArray(ais);
            console.log(
              '[HC Profiles] Provider AI response:',
              `isArray=${isList}`,
              `type=${typeof ais}`,
              isList ? `count=${ais.length}` : `keys=${Object.keys(ais as object)}`,
            );
            if (isList) {
              console.table(
                ais.map((a) => {
                  const raw = a as unknown as Record<string, unknown>;
                  return { id: raw.id, aiId: raw.aiId, name: raw.name };
                }),
              );
            }
            setAvailableAis(isList ? ais : []);
          }
        })
        .catch((err) => {
          console.error('[HC Profiles] Failed to fetch AIs:', err);
          if (!cancelled) setAvailableAis([]);
        })
        .finally(() => {
          if (!cancelled) setFetchingAis(false);
        });
    } else {
      setAvailableAis([]);
      api
        .listProviderModels(form.provider_id)
        .then((models) => {
          if (!cancelled) setAvailableModels(Array.isArray(models) ? models : []);
        })
        .catch(() => {
          if (!cancelled) setAvailableModels([]);
        })
        .finally(() => {
          if (!cancelled) setFetchingAis(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [form.provider_id, profileType, isModelOnlyProvider]);

  /* Auto-resolve provider key when provider changes */
  useEffect(() => {
    if (!form.provider_id) return;
    const keysForProvider = filterKeysForProvider(providerKeys, form.provider_id);
    if (keysForProvider.length === 1 && keysForProvider[0]) {
      const firstKey = keysForProvider[0];
      setForm((prev) => ({ ...prev, hc_provider_key_id: firstKey.id }));
    }
  }, [form.provider_id, providerKeys]);

  const aiOptions = useMemo(() => buildAiOptions(availableAis), [availableAis]);
  const modelOptions = useMemo(() => buildModelOptions(availableModels), [availableModels]);

  function providerName(id: string) {
    return resolveProviderName(providers, id);
  }

  function handleOpenCreate() {
    setEditing(null);
    setForm(EMPTY_PROFILE_FORM);
    setProfileType('agent');
    setAvailableAis([]);
    setAvailableModels([]);
    setAdvancedOpen(false);
    setManualIdEntry(false);
    openForm();
  }

  function handleOpenEdit(profile: HcProfile) {
    setEditing(profile);
    const type = profile.profile_type === 'model' ? 'model' : 'agent';
    setProfileType(type);
    setForm({
      name: profile.name,
      provider_id: profile.provider_id,
      hc_provider_key_id: profile.hc_provider_key_id,
      external_ai_id: profile.external_ai_id,
      mode: profile.mode,
      profile_type: profile.profile_type,
      description: profile.description ?? '',
      is_active: profile.is_active,
    });
    setAdvancedOpen(false);
    setManualIdEntry(false);
    openForm();
  }

  function handleProviderChange(providerId: string | null) {
    const provType = providers.find((p) => p.id === providerId)?.type ?? '';
    if (isModelOnlyProviderType(provType) && profileType !== 'model') {
      setProfileType('model');
      notifications.show({
        title: 'Model-only Provider',
        message: 'Google Gemini profiles use model mode only.',
        color: 'blue',
      });
    }
    setForm((prev) => ({
      ...prev,
      provider_id: providerId ?? '',
      hc_provider_key_id: '',
      external_ai_id: '',
      name: prev.name,
    }));
  }

  function handleProfileTypeChange(value: string) {
    const next = value === 'model' ? 'model' : 'agent';
    setProfileType(next);
    setForm((prev) => ({
      ...prev,
      external_ai_id: '',
      profile_type: next,
      mode: next === 'model' ? 'completion' : prev.mode,
    }));
  }

  function handleAiSelect(value: string | null) {
    const ai = availableAis.find((a) => (a.id || a.aiId) === value);
    setForm((prev) => ({
      ...prev,
      external_ai_id: value ?? '',
      name: prev.name || ai?.name || '',
    }));
  }

  function handleModelSelect(value: string | null) {
    const model = availableModels.find((m) => m.model_id === value);
    setForm((prev) => ({
      ...prev,
      external_ai_id: value ?? '',
      name: prev.name || model?.display_name || '',
    }));
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.provider_id || !form.hc_provider_key_id || !form.external_ai_id.trim()) {
      notifications.show({ title: 'Validation', message: 'Please fill in all required fields.', color: 'orange' });
      return;
    }

    try {
      setSaving(true);
      const payload: Record<string, unknown> = {
        ...form,
        profile_type: isModelOnlyProvider ? 'model' : profileType,
      };
      if (!payload.description) delete payload.description;

      if (editing) {
        await api.updateHcProfile(editing.id, payload);
        notifications.show({ title: 'Updated', message: `${form.name} updated`, color: 'green' });
      } else {
        await api.createHcProfile(payload);
        notifications.show({ title: 'Created', message: `${form.name} created`, color: 'green' });
      }
      closeForm();
      setEditing(null);
      await loadData();
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

  function handleOpenDelete(profile: HcProfile) {
    setDeleteTarget(profile);
    openDelete();
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    try {
      await api.deleteHcProfile(deleteTarget.id);
      notifications.show({ title: 'Deleted', message: `${deleteTarget.name} removed`, color: 'orange' });
      closeDelete();
      setDeleteTarget(null);
      await loadData();
    } catch (err: unknown) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    }
  }

  function setField<K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleCloseForm() {
    closeForm();
    setEditing(null);
  }

  function handleCloseDelete() {
    closeDelete();
    setDeleteTarget(null);
  }

  function toggleManualIdEntry() {
    setManualIdEntry((v) => !v);
    setForm((prev) => ({ ...prev, external_ai_id: '' }));
  }

  return {
    profiles,
    providers,
    loading,
    saving,
    editing,
    form,
    formOpened,
    deleteTarget,
    deleteOpened,
    profileType,
    fetchingAis,
    advancedOpen,
    setAdvancedOpen,
    manualIdEntry,
    eligibleProviders,
    filteredKeys,
    isModelOnlyProvider,
    aiOptions,
    modelOptions,
    providerName,
    handleOpenCreate,
    handleOpenEdit,
    handleProviderChange,
    handleProfileTypeChange,
    handleAiSelect,
    handleModelSelect,
    handleSubmit,
    handleOpenDelete,
    handleConfirmDelete,
    handleCloseForm,
    handleCloseDelete,
    setField,
    toggleManualIdEntry,
  };
}
