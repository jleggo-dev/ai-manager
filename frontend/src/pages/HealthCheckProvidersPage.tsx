import { useState, useEffect, useCallback } from 'react';
import { Stack, Center, Loader, Alert, Button } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconAlertCircle } from '@tabler/icons-react';
import PageHeader from '../components/atoms/PageHeader';
import * as api from '../services/api';
import type { Provider, HcProviderKey } from '../types/api';
import { AddProviderKeyModal } from './health-check-providers/AddProviderKeyModal';
import { DeleteProviderKeyModal } from './health-check-providers/DeleteProviderKeyModal';
import { EditProviderKeyModal } from './health-check-providers/EditProviderKeyModal';
import { ProvidersKeysTable } from './health-check-providers/ProvidersKeysTable';
import { EMPTY_FORM, type KeyFormState } from './health-check-providers/types';

interface HealthCheckProvidersPageProps {
  onNavigate: (key: string, params?: Record<string, unknown>) => void;
  pageParams: Record<string, unknown>;
  workspaceRole?: string | null;
}

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

  function handleConfigureKey(providerId: string) {
    setForm({ ...EMPTY_FORM, provider_id: providerId });
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

  return (
    <Stack>
      <PageHeader title="Provider Keys">
        <Button leftSection={<IconPlus size={16} />} onClick={handleOpenAdd}>
          Add Provider Key
        </Button>
      </PageHeader>

      <ProvidersKeysTable
        providers={providers}
        getKeyForProvider={getKeyForProvider}
        onConfigureKey={handleConfigureKey}
        onEdit={handleOpenEdit}
        onDelete={handleOpenDelete}
      />

      <AddProviderKeyModal
        opened={addOpened}
        onClose={closeAdd}
        form={form}
        setForm={setForm}
        providerSelectData={providerSelectData}
        onCreate={handleCreate}
        submitting={submitting}
      />

      <EditProviderKeyModal
        opened={editOpened}
        onClose={closeEdit}
        form={form}
        setForm={setForm}
        providerSelectData={providerSelectData}
        onUpdate={handleUpdate}
        submitting={submitting}
      />

      <DeleteProviderKeyModal
        opened={deleteOpened}
        onClose={closeDelete}
        deletingKey={deletingKey}
        onDelete={handleDelete}
        submitting={submitting}
      />
    </Stack>
  );
}
