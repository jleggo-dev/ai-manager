import { useEffect, useState, useCallback } from 'react';
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
  Switch,
  Alert,
  ActionIcon,
  Tooltip,
  Collapse,
  NumberInput,
  Box,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconStethoscope,
  IconEdit,
  IconTrash,
  IconPlayerPlay,
  IconChevronDown,
  IconChevronUp,
  IconAlertCircle,
} from '@tabler/icons-react';
import PageHeader from '../components/atoms/PageHeader';
import InvestigationPanel from '../components/InvestigationPanel';
import * as api from '../services/api';
import type { HcCheck, HcProfile } from '../types/api';
import { HEALTH_STATUS_CONFIG } from '../constants/healthStatus';
import { CHECK_RUN_STATUS_COLORS } from '../constants/checkRunStatus';

interface HealthCheckConfigPageProps {
  onNavigate: (key: string, params?: Record<string, unknown>) => void;
  pageParams: Record<string, unknown>;
  workspaceRole?: string | null;
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const CADENCE_OPTIONS = [
  { value: '1', label: '1 min' },
  { value: '5', label: '5 min' },
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '60', label: '60 min' },
];

interface FormState {
  name: string;
  health_check_profile_id: string;
  test_message: string;
  cadence_minutes: string;
  outage_cadence_minutes: number;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  health_check_profile_id: '',
  test_message: 'Hello, please confirm you are operational.',
  cadence_minutes: '5',
  outage_cadence_minutes: 2,
  is_active: true,
};

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

  const formModal = (
    <Stack gap="md">
      <TextInput
        label="Name"
        placeholder="e.g. GPT-4 heartbeat"
        value={form.name ?? ''}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setForm((f) => ({ ...f, name: v }));
        }}
        required
      />
      <Textarea
        label="Test Message"
        placeholder="Message sent to the AI for health verification"
        value={form.test_message ?? ''}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setForm((f) => ({ ...f, test_message: v }));
        }}
        minRows={2}
        required
      />
      <Select
        label="Cadence"
        data={CADENCE_OPTIONS}
        value={form.cadence_minutes ?? '5'}
        onChange={(val) => setForm((f) => ({ ...f, cadence_minutes: val || '5' }))}
        required
      />
      <NumberInput
        label="Outage Cadence (minutes)"
        description="Accelerated check frequency while an outage is active"
        min={1}
        max={1440}
        value={form.outage_cadence_minutes ?? 2}
        onChange={(val) => setForm((f) => ({ ...f, outage_cadence_minutes: typeof val === 'number' ? val : 2 }))}
      />
      <Switch
        label="Active"
        checked={form.is_active ?? true}
        onChange={(e) => {
          const v = e.currentTarget.checked;
          setForm((f) => ({ ...f, is_active: v }));
        }}
      />
    </Stack>
  );

  return (
    <Stack>
      <PageHeader title="API Health" />

      {checks.length === 0 ? (
        <Center py="xl">
          <Stack align="center" gap="xs">
            <IconStethoscope size={48} color="gray" />
            <Text c="dimmed">No health checks yet. Create a profile to get started.</Text>
          </Stack>
        </Center>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th />
              <Table.Th>Name</Table.Th>
              <Table.Th>Profile</Table.Th>
              <Table.Th>Cadence</Table.Th>
              <Table.Th>Last Run</Table.Th>
              <Table.Th>Health</Table.Th>
              <Table.Th>Enabled</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {checks.map((check) => (
              <CheckRow
                key={check.id}
                check={check}
                profileName={profileNameMap[check.health_check_profile_id] || '—'}
                expanded={expandedId === check.id}
                onExpand={() => handleExpand(check.id)}
                onEdit={() => handleEditOpen(check)}
                onDelete={() => handleDeleteOpen(check)}
                onRunNow={() => handleRunNow(check.id)}
              />
            ))}
          </Table.Tbody>
        </Table>
      )}

      {/* Edit Modal */}
      <Modal opened={editOpened} onClose={closeEdit} title="Edit Health Check" size="md">
        {editOpened && (
          <>
            {formModal}
            <Group justify="flex-end" mt="lg">
              <Button variant="default" onClick={closeEdit}>
                Cancel
              </Button>
              <Button onClick={handleUpdate} loading={saving} disabled={!form.name || !form.health_check_profile_id}>
                Save
              </Button>
            </Group>
          </>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal opened={deleteOpened} onClose={closeDelete} title="Delete Health Check" size="sm">
        <Stack gap="md">
          <Text size="sm">
            Are you sure you want to delete <strong>{deletingCheck?.name}</strong>? All run history and incidents will
            be permanently removed.
          </Text>
          <Switch
            label="Also delete the linked profile"
            checked={deleteAlsoProfile}
            onChange={(e) => {
              const v = e.currentTarget.checked;
              setDeleteAlsoProfile(v);
            }}
          />
          {deleteAlsoProfile && (
            <Alert color="orange" variant="light" title="Profile will be removed">
              The linked health check profile will also be deleted. This cannot be undone.
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeDelete}>
              Cancel
            </Button>
            <Button color="red" onClick={handleDelete} loading={saving}>
              {deleteAlsoProfile ? 'Delete Both' : 'Delete Check Only'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

interface CheckRowProps {
  check: HcCheck;
  profileName: string;
  expanded: boolean;
  onExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRunNow: () => void;
}

function CheckRow({ check, profileName, expanded, onExpand, onEdit, onDelete, onRunNow }: CheckRowProps) {
  return (
    <>
      <Table.Tr style={{ cursor: 'pointer' }} onClick={onExpand}>
        <Table.Td>{expanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}</Table.Td>
        <Table.Td>{check.name}</Table.Td>
        <Table.Td>{profileName}</Table.Td>
        <Table.Td>{check.cadence_minutes} min</Table.Td>
        <Table.Td>{relativeTime(check.last_run_at)}</Table.Td>
        <Table.Td>
          {(() => {
            const hs = HEALTH_STATUS_CONFIG[check.healthStatus ?? 'unknown'];
            return (
              <Group gap={6} wrap="nowrap">
                <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: hs.hex, flexShrink: 0 }} />
                <Text size="xs" fw={500} c={hs.color}>
                  {hs.label}
                </Text>
              </Group>
            );
          })()}
        </Table.Td>
        <Table.Td>
          <Badge size="xs" color={check.is_active ? 'teal' : 'gray'} variant="light">
            {check.is_active ? 'Enabled' : 'Disabled'}
          </Badge>
        </Table.Td>
        <Table.Td onClick={(e) => e.stopPropagation()}>
          <Group gap="xs">
            <Tooltip label="Run Now">
              <ActionIcon variant="subtle" color="blue" onClick={onRunNow} aria-label="Run Now">
                <IconPlayerPlay size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Edit">
              <ActionIcon variant="subtle" onClick={onEdit} aria-label="Edit">
                <IconEdit size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Delete">
              <ActionIcon variant="subtle" color="red" onClick={onDelete}>
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Table.Td>
      </Table.Tr>
      <Table.Tr>
        <Table.Td colSpan={8} p={0} style={{ border: expanded ? undefined : 'none' }}>
          <Collapse in={expanded}>
            <Box p="md">
              <InvestigationPanel checkId={check.id} />
            </Box>
          </Collapse>
        </Table.Td>
      </Table.Tr>
    </>
  );
}
