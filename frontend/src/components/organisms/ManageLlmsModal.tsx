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

import { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  Stack,
  Group,
  Select,
  TextInput,
  Button,
  Table,
  ScrollArea,
  Switch,
  ActionIcon,
  Text,
  Loader,
  Center,
  Alert,
  Badge,
  Textarea,
  Collapse,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconTrash, IconPlus, IconSearch, IconUpload, IconRefresh } from '@tabler/icons-react';
import * as api from '../../services/api';
import type { Provider, LlmModel } from '../../types/api';

/* ── Category auto-detection (mirrors backend seed logic) ──────── */
const CATEGORY_RULES = [
  {
    test: (id: string) => /^(flux-|stable-diffusion|ideogram-|minimax-image|recraft-|bytedance-|gpt-image)/.test(id),
    category: 'Image Generation',
  },
  { test: (id: string) => /^(google-imagen|replicate-google-imagen)/.test(id), category: 'Image Generation' },
  { test: (id: string) => /^(gpt-|gpt3|o1-|o3|o4)/.test(id), category: 'OpenAI' },
  { test: (id: string) => /^(anthropic-claude|claude-)/.test(id), category: 'Anthropic' },
  { test: (id: string) => /^gemini-/.test(id), category: 'Google' },
  { test: (id: string) => /^perplexity-/.test(id), category: 'Perplexity' },
  { test: (id: string) => /^(llama-|meta-llama|codellama)/.test(id), category: 'Meta' },
  { test: (id: string) => /^deepseek-/.test(id), category: 'DeepSeek' },
  { test: (id: string) => /^cohere-/.test(id), category: 'Cohere' },
  { test: (id: string) => /^grok-/.test(id), category: 'xAI' },
];

function autoCategory(modelId: string) {
  for (const rule of CATEGORY_RULES) {
    if (rule.test(modelId)) return rule.category;
  }
  return 'Other';
}

function prettifyModelId(modelId: string) {
  return modelId
    .split(/[-_]/)
    .map((s: string) =>
      /^\d+(\.\d+)?$/.test(s) || /^\d+[a-z]+$/i.test(s) ? s : s.charAt(0).toUpperCase() + s.slice(1),
    )
    .join(' ');
}

/* ── Category color mapping for badges ─────────────────────────── */
const CATEGORY_COLORS: Record<string, string> = {
  OpenAI: 'green',
  Anthropic: 'orange',
  Google: 'blue',
  Perplexity: 'cyan',
  Meta: 'indigo',
  DeepSeek: 'violet',
  Cohere: 'pink',
  xAI: 'red',
  'Image Generation': 'grape',
  Other: 'gray',
};

function getLatestModelUpdate(models: LlmModel[] = []) {
  const dates = models
    .map((m) => m?.updated_at || m?.created_at || '')
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (dates.length === 0) return '';
  dates.sort((a, b) => b.getTime() - a.getTime());
  const latest = dates[0];
  return latest ? latest.toISOString() : '';
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

interface ManageLlmsModalProps {
  opened: boolean;
  onClose: () => void;
  providers: Provider[];
}

export default function ManageLlmsModal({ opened, onClose, providers }: ManageLlmsModalProps) {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [bulkOpened, { toggle: toggleBulk }] = useDisclosure(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkImporting, setBulkImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState('');

  /* Single model add form */
  const [newModelId, setNewModelId] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newCategory, setNewCategory] = useState('');

  const providerOptions = (providers || []).map((p: Provider) => ({ value: p.id, label: `${p.name} (${p.type})` }));
  const selectedProviderRow = (providers || []).find((p: Provider) => p.id === selectedProvider) || null;
  const syncableProvider = selectedProviderRow && ['google-gemini', 'devs-ai', 'devs-ai-v2'].includes(selectedProviderRow.type);

  /* Auto-select first provider when modal opens */
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

  /* ── Handlers ─────────────────────────────────────────────────── */

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

  /* ── Filter and group models ──────────────────────────────────── */
  const filtered = models.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.model_id.toLowerCase().includes(q) ||
      (m.display_name || '').toLowerCase().includes(q) ||
      (m.category || '').toLowerCase().includes(q)
    );
  });

  /* Group by category for display */
  const grouped: Record<string, LlmModel[]> = {};
  for (const m of filtered) {
    const cat = m.category || 'Other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(m);
  }
  const sortedCategories = Object.keys(grouped).sort();

  /* Gather unique categories for the add form dropdown */
  const existingCategories = [...new Set(models.map((m) => m.category).filter((c): c is string => !!c))].sort();
  const categorySelectData = existingCategories.map((c) => ({ value: c, label: c }));

  return (
    <Modal opened={opened} onClose={onClose} title="Manage LLM Models" size="xl">
      <Stack gap="sm">
        {/* Provider selector */}
        <Select
          label="Provider"
          placeholder="Select a provider"
          data={providerOptions}
          value={selectedProvider}
          onChange={(v) => {
            setSelectedProvider(v);
            setModels([]);
            setLastRefreshAt('');
          }}
        />

        {/* Search bar */}
        <TextInput
          placeholder="Search models by name, ID, or category..."
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* Stats */}
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            {models.length} total models
          </Text>
          {search && (
            <Text size="xs" c="dimmed">
              ({filtered.length} matching)
            </Text>
          )}
          {lastRefreshAt && (
            <Text size="xs" c="dimmed">
              Last refresh: {formatTimestamp(lastRefreshAt)}
            </Text>
          )}
          {syncableProvider && (
            <Button
              variant="light"
              size="xs"
              leftSection={<IconRefresh size={12} />}
              onClick={handleSyncFromProvider}
              loading={syncing}
            >
              Refresh from Provider
            </Button>
          )}
        </Group>

        {/* Model list */}
        {loading ? (
          <Center py="lg">
            <Loader size="sm" />
          </Center>
        ) : filtered.length === 0 ? (
          <Alert color="blue" variant="light">
            {models.length === 0 ? 'No models registered for this provider.' : 'No models match the search.'}
          </Alert>
        ) : (
          <ScrollArea h={350}>
            <Table striped highlightOnHover withTableBorder withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Model ID</Table.Th>
                  <Table.Th>Display Name</Table.Th>
                  <Table.Th>Category</Table.Th>
                  <Table.Th w={70}>Active</Table.Th>
                  <Table.Th w={50} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sortedCategories.map((cat) =>
                  (grouped[cat] ?? []).map((m) => (
                    <Table.Tr key={m.id}>
                      <Table.Td>
                        <Text size="xs" ff="monospace">
                          {m.model_id}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{m.display_name}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="xs" variant="light" color={CATEGORY_COLORS[cat] || 'gray'}>
                          {cat}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Switch size="xs" checked={m.is_active} onChange={() => handleToggleActive(m)} />
                      </Table.Td>
                      <Table.Td>
                        <Tooltip label="Remove model">
                          <ActionIcon size="xs" variant="subtle" color="red" onClick={() => handleDelete(m)}>
                            <IconTrash size={12} />
                          </ActionIcon>
                        </Tooltip>
                      </Table.Td>
                    </Table.Tr>
                  )),
                )}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}

        {/* Add single model form */}
        <Text size="sm" fw={600} mt="xs">
          Add Model
        </Text>
        <Group gap="xs" align="flex-end">
          <TextInput
            label="Model ID"
            placeholder="e.g. gpt-5.3-codex"
            value={newModelId}
            onChange={(e) => setNewModelId(e.target.value)}
            style={{ flex: 2 }}
            size="xs"
          />
          <TextInput
            label="Display Name"
            placeholder="Auto-generated if blank"
            value={newDisplayName}
            onChange={(e) => setNewDisplayName(e.target.value)}
            style={{ flex: 2 }}
            size="xs"
          />
          <Select
            label="Category"
            placeholder="Auto-detect"
            data={categorySelectData}
            value={newCategory}
            onChange={(v) => setNewCategory(v || '')}
            clearable
            searchable
            style={{ flex: 1 }}
            size="xs"
          />
          <Button
            size="xs"
            leftSection={<IconPlus size={12} />}
            onClick={handleAddSingle}
            disabled={!newModelId.trim()}
          >
            Add
          </Button>
        </Group>

        {/* Bulk import */}
        <Group gap="xs">
          <Button variant="light" size="xs" leftSection={<IconUpload size={12} />} onClick={toggleBulk}>
            {bulkOpened ? 'Hide Bulk Import' : 'Bulk Import'}
          </Button>
        </Group>

        <Collapse in={bulkOpened}>
          <Stack gap="xs">
            <Textarea
              label="Paste model IDs (one per line)"
              placeholder={'gpt-5.3-codex\nanthropic-claude-4-sonnet\ngemini-3-pro'}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              minRows={4}
              maxRows={8}
              styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
            />
            <Group justify="flex-end">
              <Button size="xs" onClick={handleBulkImport} loading={bulkImporting} disabled={!bulkText.trim()}>
                Import {bulkText.split('\n').filter((l) => l.trim()).length} model(s)
              </Button>
            </Group>
          </Stack>
        </Collapse>
      </Stack>
    </Modal>
  );
}
