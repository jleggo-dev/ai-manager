import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Stack,
  Group,
  Text,
  Badge,
  Button,
  Table,
  Center,
  Loader,
  Modal,
  TextInput,
  Textarea,
  Select,
  SegmentedControl,
  Switch,
  Alert,
  ActionIcon,
  Tooltip,
  Code,
  Collapse,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconBrain,
  IconPlus,
  IconEdit,
  IconTrash,
  IconAlertCircle,
  IconChevronDown,
  IconChevronUp,
} from '@tabler/icons-react';
import PageHeader from '../components/atoms/PageHeader';
import * as api from '../services/api';
import type { HcProfile, Provider, HcProviderKey, LlmModel } from '../types/api';

interface ProviderAi {
  id?: string;
  aiId?: string;
  name?: string;
}

interface HealthCheckProfilesPageProps {
  onNavigate: (key: string, params?: Record<string, unknown>) => void;
  pageParams: Record<string, unknown>;
  workspaceRole?: string | null;
}

interface ProfileFormState {
  name: string;
  provider_id: string;
  hc_provider_key_id: string;
  external_ai_id: string;
  mode: string;
  profile_type: string;
  description: string;
  is_active: boolean;
}

const EMPTY_FORM: ProfileFormState = {
  name: '',
  provider_id: '',
  hc_provider_key_id: '',
  external_ai_id: '',
  mode: 'completion',
  profile_type: 'agent',
  description: '',
  is_active: true,
};

export default function HealthCheckProfilesPage({
  onNavigate: _onNavigate,
  pageParams: _pageParams,
  workspaceRole: _workspaceRole,
}: HealthCheckProfilesPageProps) {
  const [profiles, setProfiles] = useState<HcProfile[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerKeys, setProviderKeys] = useState<HcProviderKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<HcProfile | null>(null);
  const [form, setForm] = useState<ProfileFormState>(EMPTY_FORM);
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

  /* Providers that have at least one HC key configured */
  const eligibleProviders = useMemo(() => {
    const keyProviderIds = new Set(providerKeys.map((k) => k.provider_id));
    return providers.filter((p) => keyProviderIds.has(p.id));
  }, [providers, providerKeys]);

  /* Keys filtered to currently selected provider */
  const filteredKeys = useMemo(
    () => providerKeys.filter((k) => k.provider_id === form.provider_id),
    [providerKeys, form.provider_id],
  );

  const selectedProviderType = providers.find((p) => p.id === form.provider_id)?.type ?? '';
  const isModelOnlyProvider = selectedProviderType === 'google-gemini';

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
    const keysForProvider = providerKeys.filter((k) => k.provider_id === form.provider_id);
    if (keysForProvider.length === 1 && keysForProvider[0]) {
      const firstKey = keysForProvider[0];
      setForm((prev) => ({ ...prev, hc_provider_key_id: firstKey.id }));
    }
  }, [form.provider_id, providerKeys]);

  /* Build select options for agents (Devs.ai returns id/aiId, not external_ai_id) */
  const aiOptions = availableAis.map((ai) => ({
    value: ai.id || ai.aiId || String(ai),
    label: ai.name || ai.id || String(ai),
  }));

  /* Build select options for models, grouped by category */
  const modelOptions = (() => {
    const activeModels = availableModels.filter((m) => m.is_active);
    const groups: Record<string, { value: string; label: string }[]> = {};
    for (const m of activeModels) {
      const g = m.category || 'Other';
      if (!groups[g]) groups[g] = [];
      const group = groups[g] ?? (groups[g] = []);
      group.push({ value: m.model_id, label: m.display_name || m.model_id });
    }
    return Object.entries(groups).map(([group, items]) => ({ group, items }));
  })();

  function providerName(id: string) {
    return providers.find((p) => p.id === id)?.name ?? id;
  }

  function handleOpenCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
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
    if (provType === 'google-gemini' && profileType !== 'model') {
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

  if (loading)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  return (
    <Stack gap="md">
      <PageHeader title="Health Check Profiles">
        <Button leftSection={<IconPlus size={16} />} onClick={handleOpenCreate}>
          New Profile
        </Button>
      </PageHeader>

      {profiles.length === 0 ? (
        <Alert icon={<IconAlertCircle size={16} />} color="blue" variant="light">
          No health check profiles yet. Create one to start monitoring your AI providers.
        </Alert>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Provider</Table.Th>
              <Table.Th>Model / Agent ID</Table.Th>
              <Table.Th>Mode</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th style={{ width: 100 }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {profiles.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>
                  <Group gap="xs">
                    <IconBrain size={16} />
                    <Text size="sm" fw={500}>
                      {p.name}
                    </Text>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{p.provider?.name ?? providerName(p.provider_id)}</Text>
                </Table.Td>
                <Table.Td>
                  <Code>{p.external_ai_id}</Code>
                </Table.Td>
                <Table.Td>
                  <Badge size="xs" variant="light">
                    {p.mode}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Badge size="xs" variant="light" color={p.is_active ? 'green' : 'gray'}>
                    {p.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    <Tooltip label="Edit">
                      <ActionIcon variant="subtle" size="sm" onClick={() => handleOpenEdit(p)}>
                        <IconEdit size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Delete">
                      <ActionIcon variant="subtle" color="red" size="sm" onClick={() => handleOpenDelete(p)}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {/* Create / Edit Modal */}
      <Modal
        opened={formOpened}
        onClose={() => {
          closeForm();
          setEditing(null);
        }}
        title={editing ? 'Edit Health Check Profile' : 'New Health Check Profile'}
        size="md"
      >
        <Stack gap="sm">
          <Select
            label="Provider"
            placeholder="Select a provider"
            required
            data={eligibleProviders.map((p) => ({ value: p.id, label: `${p.name} (${p.type})` }))}
            value={form.provider_id || null}
            onChange={handleProviderChange}
            searchable
          />

          {form.provider_id && (
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
          )}

          {form.provider_id && !fetchingAis && (
            <>
              {!manualIdEntry &&
                (isModelOnlyProvider ? 'model' : profileType) === 'agent' &&
                (aiOptions.length > 0 ? (
                  <Select
                    label="Available AI"
                    placeholder="Type to search agents..."
                    data={aiOptions}
                    value={form.external_ai_id || null}
                    onChange={handleAiSelect}
                    searchable
                    required
                  />
                ) : (
                  <TextInput
                    label="External AI ID"
                    placeholder="e.g. agent-abc123"
                    value={form.external_ai_id}
                    onChange={(e) => setField('external_ai_id', e.currentTarget.value)}
                    required
                  />
                ))}

              {!manualIdEntry &&
                (isModelOnlyProvider ? 'model' : profileType) === 'model' &&
                (modelOptions.length > 0 ? (
                  <Select
                    label="LLM Model"
                    placeholder="Type to search models..."
                    data={modelOptions}
                    value={form.external_ai_id || null}
                    onChange={handleModelSelect}
                    searchable
                    required
                  />
                ) : (
                  <TextInput
                    label="Model ID"
                    placeholder="e.g. gpt-4o or claude-sonnet-4-20250514"
                    value={form.external_ai_id}
                    onChange={(e) => setField('external_ai_id', e.currentTarget.value)}
                    required
                  />
                ))}

              {manualIdEntry && (
                <TextInput
                  label="External AI ID"
                  placeholder="Paste the AI ID, e.g. a843e28a-c616-4172-9594-a41ab7a8260b"
                  value={form.external_ai_id}
                  onChange={(e) => setField('external_ai_id', e.currentTarget.value)}
                  required
                />
              )}

              <Text
                size="xs"
                c="blue"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  setManualIdEntry((v) => !v);
                  setForm((prev) => ({ ...prev, external_ai_id: '' }));
                }}
              >
                {manualIdEntry ? '← Back to list' : "Can't find your AI? Enter ID manually"}
              </Text>
            </>
          )}

          {fetchingAis && form.provider_id && (
            <Center py="xs">
              <Loader size="sm" />
              <Text size="xs" c="dimmed" ml="xs">
                Loading available {profileType === 'agent' ? 'agents' : 'models'}…
              </Text>
            </Center>
          )}

          <TextInput
            label="Name"
            placeholder="e.g. GPT-4 Health Check"
            required
            value={form.name}
            onChange={(e) => setField('name', e.currentTarget.value)}
            description="Auto-filled from selection — edit to customize"
          />

          {/* Show provider key selector only when multiple keys exist */}
          {filteredKeys.length > 1 && (
            <Select
              label="Provider Key"
              placeholder="Select a key"
              required
              data={filteredKeys.map((k) => ({ value: k.id, label: k.name }))}
              value={form.hc_provider_key_id || null}
              onChange={(val) => setField('hc_provider_key_id', val ?? '')}
            />
          )}

          <Switch
            label="Active"
            checked={form.is_active}
            onChange={(e) => setField('is_active', e.currentTarget.checked)}
          />

          <Button
            variant="subtle"
            size="compact-sm"
            onClick={() => setAdvancedOpen((o) => !o)}
            rightSection={advancedOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          >
            Advanced Settings
          </Button>
          <Collapse in={advancedOpen}>
            <Stack gap="sm">
              <Select
                label="Mode"
                data={[
                  { value: 'completion', label: 'Completion' },
                  { value: 'chat', label: 'Chat' },
                ]}
                value={form.mode}
                onChange={(val) => setField('mode', val ?? 'completion')}
              />

              <Textarea
                label="Description"
                placeholder="Optional description"
                value={form.description}
                onChange={(e) => setField('description', e.currentTarget.value)}
                autosize
                minRows={2}
              />
            </Stack>
          </Collapse>

          <Group justify="flex-end" mt="md">
            <Button
              variant="default"
              onClick={() => {
                closeForm();
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} loading={saving}>
              {editing ? 'Save Changes' : 'Create Profile'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        opened={deleteOpened}
        onClose={() => {
          closeDelete();
          setDeleteTarget(null);
        }}
        title="Delete Health Check Profile"
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>?
          </Text>
          <Alert color="orange" variant="light" title="Linked data will be removed">
            The associated health check, all run history, and any incidents will also be permanently deleted.
          </Alert>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                closeDelete();
                setDeleteTarget(null);
              }}
            >
              Cancel
            </Button>
            <Button color="red" onClick={handleConfirmDelete}>
              Delete Profile &amp; Health Check
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
