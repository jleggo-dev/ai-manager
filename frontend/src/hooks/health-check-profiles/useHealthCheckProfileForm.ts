/**
 * Health Check Profiles form modal state + submit/delete handlers.
 */

import { useEffect, useMemo, useState } from 'react';
import { useDisclosure } from '@mantine/hooks';
import type { HcProfile, HcProviderKey, Provider } from '../../types/api';
import {
  filterEligibleProviders,
  filterKeysForProvider,
  isModelOnlyProviderType,
  resolveProviderName,
} from '../../lib/health-check-profiles';
import { EMPTY_PROFILE_FORM, type ProfileFormState } from './profileFormTypes';
import { useProviderCatalogOptions } from './useProviderCatalogOptions';
import { createProfileFormOpenHandlers } from './profileFormOpenHandlers';
import { createProfileFormSelectHandlers } from './profileFormSelectHandlers';
import { createProfileFormMutationHandlers } from './profileFormMutationHandlers';

interface UseHealthCheckProfileFormArgs {
  providers: Provider[];
  providerKeys: HcProviderKey[];
  loadData: () => Promise<void>;
}

export function useHealthCheckProfileForm({ providers, providerKeys, loadData }: UseHealthCheckProfileFormArgs) {
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<HcProfile | null>(null);
  const [form, setForm] = useState<ProfileFormState>(EMPTY_PROFILE_FORM);
  const [formOpened, { open: openForm, close: closeForm }] = useDisclosure(false);
  const [deleteTarget, setDeleteTarget] = useState<HcProfile | null>(null);
  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);
  const [profileType, setProfileType] = useState<'agent' | 'model'>('agent');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [manualIdEntry, setManualIdEntry] = useState(false);

  const eligibleProviders = useMemo(() => filterEligibleProviders(providers, providerKeys), [providers, providerKeys]);
  const filteredKeys = useMemo(
    () => filterKeysForProvider(providerKeys, form.provider_id),
    [providerKeys, form.provider_id],
  );
  const selectedProviderType = providers.find((p) => p.id === form.provider_id)?.type ?? '';
  const isModelOnlyProvider = isModelOnlyProviderType(selectedProviderType);

  const { availableAis, availableModels, fetchingAis, aiOptions, modelOptions, resetCatalog } =
    useProviderCatalogOptions(form.provider_id, profileType, isModelOnlyProvider);

  useEffect(() => {
    if (!form.provider_id) return;
    const keysForProvider = filterKeysForProvider(providerKeys, form.provider_id);
    if (keysForProvider.length === 1 && keysForProvider[0]) {
      const firstKey = keysForProvider[0];
      setForm((prev) => ({ ...prev, hc_provider_key_id: firstKey.id }));
    }
  }, [form.provider_id, providerKeys]);

  function providerName(id: string) {
    return resolveProviderName(providers, id);
  }

  const openHandlers = createProfileFormOpenHandlers({
    setEditing,
    setForm,
    setProfileType,
    resetCatalog,
    setAdvancedOpen,
    setManualIdEntry,
    openForm,
    closeForm,
    openDelete,
    closeDelete,
    setDeleteTarget,
  });

  const selectHandlers = createProfileFormSelectHandlers({
    setForm,
    profileType,
    setProfileType,
    providers,
    availableAis,
    availableModels,
  });

  const mutationHandlers = createProfileFormMutationHandlers({
    form,
    editing,
    setEditing,
    profileType,
    isModelOnlyProvider,
    deleteTarget,
    setDeleteTarget,
    setSaving,
    closeForm,
    closeDelete,
    loadData,
  });

  return {
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
    ...openHandlers,
    ...selectHandlers,
    ...mutationHandlers,
  };
}
