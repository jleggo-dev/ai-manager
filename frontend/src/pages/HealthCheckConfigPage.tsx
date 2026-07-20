import { useEffect, useState, useCallback } from 'react';
import { Stack, Center, Loader, Alert } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle } from '@tabler/icons-react';
import PageHeader from '../components/atoms/PageHeader';
import * as api from '../services/api';
import type { HcCheck, HcProfile } from '../types/api';
import { CHECK_RUN_STATUS_COLORS } from '../constants/checkRunStatus';
import { ChecksTable } from './health-check-config/ChecksTable';
import { DeleteCheckModal } from './health-check-config/DeleteCheckModal';
import { EditCheckModal } from './health-check-config/EditCheckModal';
import { EMPTY_FORM, type FormState } from './health-check-config/helpers';

interface HealthCheckConfigPageProps {
  onNavigate: (key: string, params?: Record<string, unknown>) => void;
  pageParams: Record<string, unknown>;
  workspaceRole?: string | null;
}

export default function HealthCheckConfigPage(_props: HealthCheckConfigPageProps) {
  const [checks, setChecks] = useState<HcCheck[]>([]);
  const [profiles, setProfiles] = useState<HcProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure(false);
  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingCheck, setDeletingCheck] = useState<HcCheck | null>(null);
  const [saving, setSaving] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [checksRes, profilesRes] = await Promise.all([api.listHcChecks(), api.listHcProfiles()]);
      setChecks(checksRes.data);
      setProfiles(profilesRes.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load health checks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleExpand = useCallback((checkId: string) => {
    setExpandedId((prev) => (prev === checkId ? null : checkId));
  }, []);

  const handleEditOpen = (check: HcCheck) => {
    setEditingId(check.id);
    setForm({
      name: check.name ?? '',
      health_check_profile_id: check.health_check_profile_id ?? '',
      test_message: check.test_message ?? 'Hello, please confirm you are operational.',
      cadence_minutes: String(check.cadence_minutes ?? 5),
      outage_cadence_minutes: check.outage_cadence_minutes ?? 2,
      is_active: check.is_active ?? true,
    });
    openEdit();
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await api.updateHcCheck(editingId, {
        name: form.name,
        health_check_profile_id: form.health_check_profile_id,
        test_message: form.test_message,
        cadence_minutes: Number(form.cadence_minutes),
        outage_cadence_minutes: form.outage_cadence_minutes,
        is_active: form.is_active,
      });
      notifications.show({ title: 'Updated', message: 'Health check updated successfully', color: 'green' });
      closeEdit();
      setForm(EMPTY_FORM);
      setEditingId(null);
      await loadData();
    } catch (err: unknown) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : 'Failed to update',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteOpen = (check: HcCheck) => {
    setDeletingCheck(check);
    openDelete();
  };

  const [deleteAlsoProfile, setDeleteAlsoProfile] = useState(true);

  const handleDelete = async () => {
    if (!deletingCheck) return;
    setSaving(true);
    try {
      await api.deleteHcCheck(deletingCheck.id, deleteAlsoProfile);
      const msg = deleteAlsoProfile ? 'Health check and profile deleted' : 'Health check deleted';
      notifications.show({ title: 'Deleted', message: msg, color: 'green' });
      closeDelete();
      setDeletingCheck(null);
      setDeleteAlsoProfile(true);
      await loadData();
    } catch (err: unknown) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : 'Failed to delete',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async (id: string) => {
    try {
      const result = await api.runHcCheck(id);
      notifications.show({
        title: 'Run Complete',
        message: `Status: ${result.status}${result.response_time_ms ? ` (${result.response_time_ms}ms)` : ''}`,
        color: CHECK_RUN_STATUS_COLORS[result.status] || 'gray',
      });
      await loadData();
    } catch (err: unknown) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : 'Failed to run check',
        color: 'red',
      });
    }
  };

  const profileNameMap = profiles.reduce<Record<string, string>>((acc, p) => {
    acc[p.id] = p.name;
    return acc;
  }, {});

  if (loading) {
    return (
      <Stack>
        <PageHeader title="API Health" />
        <Center py="xl">
          <Loader />
        </Center>
      </Stack>
    );
  }

  if (error) {
    return (
      <Stack>
        <PageHeader title="API Health" />
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
          {error}
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack>
      <PageHeader title="API Health" />

      <ChecksTable
        checks={checks}
        profileNameMap={profileNameMap}
        expandedId={expandedId}
        onExpand={handleExpand}
        onEdit={handleEditOpen}
        onDelete={handleDeleteOpen}
        onRunNow={handleRunNow}
      />

      <EditCheckModal
        opened={editOpened}
        onClose={closeEdit}
        form={form}
        setForm={setForm}
        onSave={handleUpdate}
        saving={saving}
      />

      <DeleteCheckModal
        opened={deleteOpened}
        onClose={closeDelete}
        deletingCheck={deletingCheck}
        deleteAlsoProfile={deleteAlsoProfile}
        onDeleteAlsoProfileChange={setDeleteAlsoProfile}
        onDelete={handleDelete}
        saving={saving}
      />
    </Stack>
  );
}
