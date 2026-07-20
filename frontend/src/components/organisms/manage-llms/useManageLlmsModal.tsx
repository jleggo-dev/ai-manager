import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import * as api from '../../../services/api';
import type { Provider, LlmModel } from '../../../types/api';
import {
  autoCategory,
  filterModels,
  getExistingCategories,
  getLatestModelUpdate,
  groupModelsByCategory,
  prettifyModelId,
} from './categoryUtils';

export function useManageLlmsModal(opened: boolean, providers: Provider[]) {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [bulkOpened, { toggle: toggleBulk }] = useDisclosure(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkImporting, setBulkImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState('');

  const [newModelId, setNewModelId] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newCategory, setNewCategory] = useState('');

  const providerOptions = (providers || []).map((p: Provider) => ({ value: p.id, label: `${p.name} (${p.type})` }));
  const selectedProviderRow = (providers || []).find((p: Provider) => p.id === selectedProvider) || null;
  const syncableProvider =
    selectedProviderRow && ['google-gemini', 'devs-ai', 'devs-ai-v2'].includes(selectedProviderRow.type);

  useEffect(() => {
    if (opened && providers.length > 0 && !selectedProvider) {
      const first = providers[0];
      if (first) setSelectedProvider(first.id);
    }
  }, [opened, providers, selectedProvider]);

  const loadModels = useCallback(async () => {
    if (!selectedProvider) return;
    try {
      setLoading(true);
      const data = await api.listProviderModels(selectedProvider);
      const nextModels = Array.isArray(data) ? data : [];
      setModels(nextModels);
      setLastRefreshAt(getLatestModelUpdate(nextModels));
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setLoading(false);
    }
  }, [selectedProvider]);

  useEffect(() => {
    if (selectedProvider) loadModels();
  }, [selectedProvider, loadModels]);

  async function handleToggleActive(model: LlmModel) {
    if (!selectedProvider) return;
    try {
      await api.updateProviderModel(selectedProvider, model.id, { is_active: !model.is_active });
      setModels((prev) => prev.map((m) => (m.id === model.id ? { ...m, is_active: !m.is_active } : m)));
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    }
  }

  async function handleDelete(model: LlmModel) {
    if (!selectedProvider) return;
    try {
      await api.deleteProviderModel(selectedProvider, model.id);
      setModels((prev) => prev.filter((m) => m.id !== model.id));
      notifications.show({ title: 'Removed', message: `${model.model_id} removed`, color: 'orange' });
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    }
  }

  async function handleAddSingle() {
    if (!newModelId.trim() || !selectedProvider) return;
    try {
      const row = await api.addProviderModel(selectedProvider, {
        model_id: newModelId.trim(),
        display_name: newDisplayName.trim() || prettifyModelId(newModelId.trim()),
        category: newCategory || autoCategory(newModelId.trim()),
      });
      setModels((prev) => [...prev, row]);
      setNewModelId('');
      setNewDisplayName('');
      setNewCategory('');
      notifications.show({ title: 'Added', message: `${row.model_id} added`, color: 'green' });
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    }
  }

  async function handleBulkImport() {
    const lines = bulkText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0 || !selectedProvider) return;

    setBulkImporting(true);
    try {
      const modelsToAdd = lines.map((modelId) => ({
        model_id: modelId,
        display_name: prettifyModelId(modelId),
        category: autoCategory(modelId),
      }));

      const results = await api.bulkAddProviderModels(selectedProvider, modelsToAdd);
      notifications.show({ title: 'Imported', message: `${results.length} model(s) imported`, color: 'green' });
      setBulkText('');
      toggleBulk();
      await loadModels();
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setBulkImporting(false);
    }
  }

  async function handleSyncFromProvider() {
    if (!selectedProvider) return;
    setSyncing(true);
    try {
      const result = await api.syncProviderModels(selectedProvider);
      notifications.show({
        title: 'Models Synced',
        message: `${result.synced ?? 0} model(s) imported (${result.discovered ?? 0} discovered).`,
        color: 'green',
      });
      if (result.discoveryNote) {
        notifications.show({
          title: 'Sync Note',
          message: result.discoveryNote,
          color: 'blue',
        });
      }
      if (result.refreshedAt) {
        setLastRefreshAt(result.refreshedAt);
      }
      await loadModels();
    } catch (err: unknown) {
      notifications.show({
        title: 'Sync Failed',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    } finally {
      setSyncing(false);
    }
  }

  function handleProviderChange(value: string | null) {
    setSelectedProvider(value);
    setModels([]);
    setLastRefreshAt('');
  }

  const filtered = useMemo(() => filterModels(models, search), [models, search]);
  const { grouped, sortedCategories } = useMemo(() => groupModelsByCategory(filtered), [filtered]);
  const categorySelectData = useMemo(
    () => getExistingCategories(models).map((c) => ({ value: c, label: c })),
    [models],
  );

  return {
    selectedProvider,
    models,
    loading,
    search,
    setSearch,
    bulkOpened,
    toggleBulk,
    bulkText,
    setBulkText,
    bulkImporting,
    syncing,
    lastRefreshAt,
    newModelId,
    setNewModelId,
    newDisplayName,
    setNewDisplayName,
    newCategory,
    setNewCategory,
    providerOptions,
    syncableProvider,
    handleProviderChange,
    handleToggleActive,
    handleDelete,
    handleAddSingle,
    handleBulkImport,
    handleSyncFromProvider,
    filtered,
    grouped,
    sortedCategories,
    categorySelectData,
  };
}
