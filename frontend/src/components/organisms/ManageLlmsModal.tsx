/**
 * Organism – ManageLlmsModal
 * ----------------------------
 * Modal for managing per-provider LLM model registries.
 * Features:
 *   - Provider selector (defaults to first provider)
 *   - Scrollable, searchable model list grouped by category
 *   - Toggle active/inactive, delete individual models
 *   - Add single model form
 *   - Bulk import via textarea (one model_id per line, auto-categorized)
 */

import { Modal, Stack, Select, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import type { Provider } from '../../types/api';
import { ManageLlmsAddForm } from './manage-llms/ManageLlmsAddForm';
import { ManageLlmsBulkImport } from './manage-llms/ManageLlmsBulkImport';
import { ManageLlmsModelList } from './manage-llms/ManageLlmsModelList';
import { useManageLlmsModal } from './manage-llms/useManageLlmsModal';

interface ManageLlmsModalProps {
  opened: boolean;
  onClose: () => void;
  providers: Provider[];
}

export default function ManageLlmsModal({ opened, onClose, providers }: ManageLlmsModalProps) {
  const {
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
  } = useManageLlmsModal(opened, providers);

  return (
    <Modal opened={opened} onClose={onClose} title="Manage LLM Models" size="xl">
      <Stack gap="sm">
        <Select
          label="Provider"
          placeholder="Select a provider"
          data={providerOptions}
          value={selectedProvider}
          onChange={handleProviderChange}
        />

        <TextInput
          placeholder="Search models by name, ID, or category..."
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <ManageLlmsModelList
          models={models}
          filtered={filtered}
          loading={loading}
          search={search}
          lastRefreshAt={lastRefreshAt}
          syncableProvider={!!syncableProvider}
          syncing={syncing}
          grouped={grouped}
          sortedCategories={sortedCategories}
          onSyncFromProvider={handleSyncFromProvider}
          onToggleActive={handleToggleActive}
          onDelete={handleDelete}
        />

        <ManageLlmsAddForm
          newModelId={newModelId}
          newDisplayName={newDisplayName}
          newCategory={newCategory}
          categorySelectData={categorySelectData}
          onModelIdChange={setNewModelId}
          onDisplayNameChange={setNewDisplayName}
          onCategoryChange={setNewCategory}
          onAdd={handleAddSingle}
        />

        <ManageLlmsBulkImport
          bulkOpened={bulkOpened}
          bulkText={bulkText}
          bulkImporting={bulkImporting}
          onToggle={toggleBulk}
          onBulkTextChange={setBulkText}
          onImport={handleBulkImport}
        />
      </Stack>
    </Modal>
  );
}
