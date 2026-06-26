import { useState, useEffect, useCallback } from 'react';
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
  PasswordInput,
  Switch,
  Select,
  Alert,
  ActionIcon,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconKey, IconPlus, IconEdit, IconTrash, IconAlertCircle } from '@tabler/icons-react';
import PageHeader from '../components/atoms/PageHeader';
import * as api from '../services/api';
import type { Provider, HcProviderKey } from '../types/api';

interface HealthCheckProvidersPageProps {
  onNavigate: (key: string, params?: Record<string, unknown>) => void;
  pageParams: Record<string, unknown>;
  workspaceRole?: string | null;
}

interface KeyFormState {
  provider_id: string;
  name: string;
  api_key: string;
  is_active: boolean;
}

const EMPTY_FORM: KeyFormState = {
  provider_id: '',
  name: '',
  api_key: '',
  is_active: true,
};

export default function HealthCheckProvidersPage({
  onNavigate: _onNavigate,
  pageParams: _pageParams,
  workspaceRole: _workspaceRole,
}: HealthCheckProvidersPageProps) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [hcKeys, setHcKeys] = useState<HcProviderKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [addOpened, { open: openAdd, close: closeAdd }] = useDisclosure(false);
  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure(false);
  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);

  const [form, setForm] = useState<KeyFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<HcProviderKey | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [providersRes, keysRes] = await Promise.all([api.listProviders(), api.listHcProviderKeys()]);
      setProviders(providersRes.data);
      setHcKeys(keysRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function getKeyForProvider(providerId: string): HcProviderKey | undefined {
    return hcKeys.find((k) => k.provider_id === providerId);
  }

  function handleOpenAdd() {
    setForm(EMPTY_FORM);
    openAdd();
  }

  function handleOpenEdit(key: HcProviderKey) {
    setEditingId(key.id);
    setForm({
      provider_id: key.provider_id,
      name: key.name,
      api_key: '',
      is_active: key.is_active,
    });
    openEdit();
  }

  function handleOpenDelete(key: HcProviderKey) {
    setDeletingKey(key);
    openDelete();
  }

  async function handleCreate() {
    if (!form.provider_id || !form.name || !form.api_key) {
      notifications.show({
        title: 'Validation Error',
        message: 'Provider, name, and API key are required.',
        color: 'red',
      });
      return;
    }
    try {
      setSubmitting(true);
      await api.createHcProviderKey({
        provider_id: form.provider_id,
        name: form.name,
        api_key: form.api_key,
        is_active: form.is_active,
      });
      notifications.show({ title: 'Success', message: 'Provider key created.', color: 'green' });
      closeAdd();
      await loadData();
    } catch (err) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : 'Failed to create key.',
        color: 'red',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate() {
    if (!editingId || !form.name) {
      notifications.show({
        title: 'Validation Error',
        message: 'Name is required.',
        color: 'red',
      });
      return;
    }
    try {
      setSubmitting(true);
      const payload: Record<string, unknown> = {
        name: form.name,
        is_active: form.is_active,
      };
      if (form.api_key) {
        payload.api_key = form.api_key;
      }
      await api.updateHcProviderKey(editingId, payload);
      notifications.show({ title: 'Success', message: 'Provider key updated.', color: 'green' });
      closeEdit();
      await loadData();
    } catch (err) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : 'Failed to update key.',
        color: 'red',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deletingKey) return;
    try {
      setSubmitting(true);
      await api.deleteHcProviderKey(deletingKey.id);
      notifications.show({ title: 'Success', message: 'Provider key deleted.', color: 'green' });
      closeDelete();
      setDeletingKey(null);
      await loadData();
    } catch (err) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : 'Failed to delete key.',
        color: 'red',
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Center h={300}>
        <Loader size="lg" />
      </Center>
    );
  }

  if (error) {
    return (
      <Stack>
        <PageHeader title="Provider Keys" />
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
          {error}
        </Alert>
      </Stack>
    );
  }

  const providerSelectData = providers.map((p) => ({
    value: p.id,
    label: `${p.name} (${p.type})`,
  }));

  const rows = providers.map((provider) => {
    const hcKey = getKeyForProvider(provider.id);
    return (
      <Table.Tr key={provider.id}>
        <Table.Td>{provider.name}</Table.Td>
        <Table.Td>
          <Badge variant="light" size="sm">
            {provider.type}
          </Badge>
        </Table.Td>
        <Table.Td>
          {hcKey ? (
            <Group gap="xs">
              <IconKey size={14} />
              <Text size="sm">{hcKey.name}</Text>
            </Group>
          ) : (
            <Text size="sm" c="dimmed">
              —
            </Text>
          )}
        </Table.Td>
        <Table.Td>
          {hcKey ? (
            <Badge color={hcKey.is_active ? 'green' : 'gray'} variant="filled" size="sm">
              {hcKey.is_active ? 'Active' : 'Inactive'}
            </Badge>
          ) : (
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={() => {
                setForm({ ...EMPTY_FORM, provider_id: provider.id });
                openAdd();
              }}
            >
              Configure Key
            </Button>
          )}
        </Table.Td>
        <Table.Td>
          {hcKey && (
            <Group gap="xs">
              <Tooltip label="Edit">
                <ActionIcon variant="subtle" onClick={() => handleOpenEdit(hcKey)}>
                  <IconEdit size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Delete">
                <ActionIcon variant="subtle" color="red" onClick={() => handleOpenDelete(hcKey)}>
                  <IconTrash size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          )}
        </Table.Td>
      </Table.Tr>
    );
  });

  return (
    <Stack>
      <PageHeader title="Provider Keys">
        <Button leftSection={<IconPlus size={16} />} onClick={handleOpenAdd}>
          Add Provider Key
        </Button>
      </PageHeader>

      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Provider Name</Table.Th>
            <Table.Th>Provider Type</Table.Th>
            <Table.Th>HC Key Name</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>{rows}</Table.Tbody>
      </Table>

      {/* Add Modal */}
      <Modal opened={addOpened} onClose={closeAdd} title="Add Provider Key" centered>
        <Stack>
          <Select
            label="Provider"
            placeholder="Select a provider"
            data={providerSelectData}
            value={form.provider_id}
            onChange={(val) => setForm((prev) => ({ ...prev, provider_id: val ?? '' }))}
            required
          />
          <TextInput
            label="Name"
            placeholder="Key name"
            value={form.name}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setForm((prev) => ({ ...prev, name: v }));
            }}
            required
          />
          <PasswordInput
            label="API Key"
            placeholder="Enter API key"
            value={form.api_key}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setForm((prev) => ({ ...prev, api_key: v }));
            }}
            required
          />
          <Switch
            label="Active"
            checked={form.is_active}
            onChange={(e) => {
              const v = e.currentTarget.checked;
              setForm((prev) => ({ ...prev, is_active: v }));
            }}
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={closeAdd}>
              Cancel
            </Button>
            <Button onClick={handleCreate} loading={submitting}>
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Edit Modal */}
      <Modal opened={editOpened} onClose={closeEdit} title="Edit Provider Key" centered>
        <Stack>
          <Select label="Provider" data={providerSelectData} value={form.provider_id} disabled />
          <TextInput
            label="Name"
            placeholder="Key name"
            value={form.name}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setForm((prev) => ({ ...prev, name: v }));
            }}
            required
          />
          <PasswordInput
            label="API Key"
            placeholder="Leave blank to keep current"
            value={form.api_key}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setForm((prev) => ({ ...prev, api_key: v }));
            }}
          />
          <Switch
            label="Active"
            checked={form.is_active}
            onChange={(e) => {
              const v = e.currentTarget.checked;
              setForm((prev) => ({ ...prev, is_active: v }));
            }}
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={closeEdit}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} loading={submitting}>
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal opened={deleteOpened} onClose={closeDelete} title="Delete Provider Key" centered>
        <Stack>
          <Text>
            Are you sure you want to delete the key{' '}
            <Text span fw={600}>
              {deletingKey?.name}
            </Text>
            ? This action cannot be undone.
          </Text>
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={closeDelete}>
              Cancel
            </Button>
            <Button color="red" onClick={handleDelete} loading={submitting}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
