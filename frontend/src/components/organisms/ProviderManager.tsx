/**
 * Organism – ProviderManager
 * ----------------------------
 * Lists providers with CRUD actions, test connectivity,
 * and create/edit forms via modal.
 *
 * CROSS-03: providers list via TanStack Query (`useProvidersQuery`); invalidate after mutate.
 */

import { useEffect, useState } from 'react';
import useConfirm from '../../hooks/useConfirm';
import {
  Stack,
  Group,
  Button,
  Card,
  Text,
  Badge,
  ActionIcon,
  Tooltip,
  Modal,
  Loader,
  Center,
  Alert,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconTrash, IconEdit, IconPlugConnected, IconAlertCircle } from '@tabler/icons-react';
import ProviderForm from '../molecules/ProviderForm';
import { useInvalidateProviders, useProvidersQuery } from '../../hooks/useProvidersQuery';
import * as api from '../../services/api';
import type { Provider } from '../../types/api';

export default function ProviderManager() {
  const confirm = useConfirm();
  const { data: providers = [], isLoading, isError, error } = useProvidersQuery();
  const invalidateProviders = useInvalidateProviders();
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  useEffect(() => {
    if (!isError) return;
    notifications.show({
      title: 'Error',
      message: error instanceof Error ? error.message : String(error),
      color: 'red',
    });
  }, [isError, error]);

  async function handleSubmit(form: Record<string, unknown>) {
    try {
      setSaving(true);
      if (editing) {
        await api.updateProvider(editing.id, form);
        notifications.show({ title: 'Updated', message: `${String(form.name)} updated`, color: 'green' });
      } else {
        await api.createProvider(form);
        notifications.show({ title: 'Created', message: `${String(form.name)} created`, color: 'green' });
      }
      closeModal();
      setEditing(null);
      await invalidateProviders();
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirm({ title: 'Delete provider', message: "This can't be undone." }))) return;
    try {
      await api.deleteProvider(id);
      notifications.show({ title: 'Deleted', message: 'Provider removed', color: 'orange' });
      await invalidateProviders();
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    }
  }

  async function handleTest(provider: Provider) {
    try {
      const result = await api.testProvider(provider.id);
      if (result.success) {
        notifications.show({ title: 'Connected', message: `${result.ai_count ?? 0} AIs found`, color: 'green' });
      } else {
        notifications.show({ title: 'Failed', message: String(result.error ?? 'Unknown error'), color: 'red' });
      }
    } catch (err: unknown) {
      notifications.show({
        title: 'Connection Failed',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    }
  }

  if (isLoading)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  return (
    <Stack gap="md">
      <Group justify="flex-end">
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => {
            setEditing(null);
            openModal();
          }}
        >
          Add Provider
        </Button>
      </Group>

      {providers.length === 0 ? (
        <Alert icon={<IconAlertCircle size={16} />} color="blue" variant="light">
          No providers configured yet. Add one to get started.
        </Alert>
      ) : (
        providers.map((p) => (
          <Card key={p.id} withBorder padding="sm">
            <Group justify="space-between">
              <Group gap="sm">
                <Text fw={600} size="sm">
                  {p.name}
                </Text>
                <Badge size="xs" variant="light">
                  {p.type}
                </Badge>
                <Badge size="xs" variant="light" color={p.is_active ? 'green' : 'gray'}>
                  {p.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </Group>
              <Group gap={4}>
                <Tooltip label="Test Connection">
                  <ActionIcon variant="subtle" color="blue" size="sm" onClick={() => handleTest(p)}>
                    <IconPlugConnected size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Edit">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={() => {
                      setEditing(p);
                      openModal();
                    }}
                  >
                    <IconEdit size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Delete">
                  <ActionIcon variant="subtle" color="red" size="sm" onClick={() => handleDelete(p.id)}>
                    <IconTrash size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
            <Text size="xs" c="dimmed" mt={4}>
              {p.base_url} — Key: {p.has_api_key ? 'Configured' : 'Not set'}
            </Text>
          </Card>
        ))
      )}

      <Modal
        opened={modalOpened}
        onClose={() => {
          closeModal();
          setEditing(null);
        }}
        title={editing ? 'Edit Provider' : 'New Provider'}
        size="md"
      >
        <ProviderForm
          initial={editing ?? undefined}
          onSubmit={handleSubmit}
          onCancel={() => {
            closeModal();
            setEditing(null);
          }}
          loading={saving}
        />
      </Modal>
    </Stack>
  );
}
