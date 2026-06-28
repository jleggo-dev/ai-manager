/**
 * Page – Platform user approval management (owner/admin only).
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Stack,
  Paper,
  Table,
  Text,
  Badge,
  Group,
  Loader,
  Alert,
  Select,
  TextInput,
  Button,
  ActionIcon,
} from '@mantine/core';
import { IconInfoCircle, IconRefresh, IconUserCheck, IconUserX, IconClock } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import PageHeader from '../components/atoms/PageHeader';
import * as api from '../services/api';
import type { AdminUser, AccountStatus } from '../services/api';
import { getWorkspaceId, getSessionUser } from '../lib/auth-session';
import { isAdminRole } from '../lib/roles';
import { listWorkspaces } from '../services/api';

const STATUS_FILTER = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'suspended', label: 'Suspended' },
];

function statusBadge(status: AccountStatus) {
  if (status === 'approved') return <Badge color="green">Approved</Badge>;
  if (status === 'suspended') return <Badge color="red">Suspended</Badge>;
  return <Badge color="yellow">Pending</Badge>;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function UserManagementPage() {
  const workspaceId = getWorkspaceId();
  const selfId = getSessionUser()?.id;
  const [viewerWorkspaceRole, setViewerWorkspaceRole] = useState<string | null>(null);
  const canManage = isAdminRole(viewerWorkspaceRole);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId || !canManage) {
      setUsers([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const res = await api.listAdminUsers({
        status: (statusFilter as AccountStatus) || undefined,
        search: search || undefined,
        limit: 100,
      });
      setUsers(res.users || []);
    } catch (err) {
      notifications.show({
        title: 'Could not load users',
        message: err instanceof Error ? err.message : 'Request failed',
        color: 'red',
      });
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, canManage, statusFilter, search]);

  useEffect(() => {
    if (!workspaceId) {
      setViewerWorkspaceRole(null);
      return;
    }
    listWorkspaces()
      .then((wsRes) => {
        const myMembership = wsRes.workspaces?.find((w) => w.workspace_id === workspaceId);
        setViewerWorkspaceRole(myMembership?.role ?? null);
      })
      .catch(() => setViewerWorkspaceRole(null));
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const onStatusChange = async (userId: string, status: AccountStatus) => {
    if (!canManage) return;
    try {
      setUpdatingId(userId);
      await api.updateUserStatus(userId, status);
      notifications.show({
        title: 'User updated',
        message: `Status set to ${status}`,
        color: 'green',
      });
      await load();
    } catch (err) {
      notifications.show({
        title: 'Update failed',
        message: err instanceof Error ? err.message : 'Request failed',
        color: 'red',
      });
    } finally {
      setUpdatingId(null);
    }
  };

  if (!workspaceId) {
    return (
      <Stack gap="md">
        <PageHeader title="Users" description="Choose a workspace to manage platform users." />
      </Stack>
    );
  }

  if (!canManage) {
    return (
      <Stack gap="md">
        <PageHeader title="Users" description="Approve or suspend platform accounts." />
        <Alert icon={<IconInfoCircle size={18} />} color="blue">
          Only workspace owners and admins can manage user approvals.
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <PageHeader
        title="Users"
        description="Review sign-ups and approve or suspend access to AI Admin. New accounts start as pending."
      />

      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" mb="md" wrap="wrap">
          <Group gap="sm">
            <Select
              label="Status"
              data={STATUS_FILTER}
              value={statusFilter}
              onChange={(v) => setStatusFilter(v || '')}
              w={180}
              size="xs"
            />
            <TextInput
              label="Search"
              placeholder="Email or name"
              value={searchInput}
              onChange={(e) => setSearchInput(e.currentTarget.value)}
              w={220}
              size="xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSearch(searchInput.trim());
              }}
            />
            <Button size="xs" variant="light" mt={22} onClick={() => setSearch(searchInput.trim())}>
              Search
            </Button>
          </Group>
          <ActionIcon variant="light" onClick={() => load()} aria-label="Refresh" mt={22}>
            <IconRefresh size={18} />
          </ActionIcon>
        </Group>

        {loading ? (
          <Group justify="center" py="xl">
            <Loader />
          </Group>
        ) : users.length === 0 ? (
          <Text c="dimmed" size="sm">
            No users match your filters.
          </Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>User</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Last sign-in</Table.Th>
                <Table.Th>Registered</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {users.map((u) => {
                const isSelf = u.id === selfId;
                const busy = updatingId === u.id;
                return (
                  <Table.Tr key={u.id}>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {u.display_name || u.email || u.id.slice(0, 8)}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {u.email || u.id}
                      </Text>
                    </Table.Td>
                    <Table.Td>{statusBadge(u.status)}</Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatWhen(u.last_sign_in_at)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatWhen(u.auth_created_at || u.created_at)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        {u.status !== 'approved' && !isSelf ? (
                          <Button
                            size="xs"
                            variant="light"
                            color="green"
                            leftSection={<IconUserCheck size={14} />}
                            loading={busy}
                            onClick={() => onStatusChange(u.id, 'approved')}
                          >
                            Approve
                          </Button>
                        ) : null}
                        {u.status === 'approved' && !isSelf ? (
                          <Button
                            size="xs"
                            variant="light"
                            color="red"
                            leftSection={<IconUserX size={14} />}
                            loading={busy}
                            onClick={() => onStatusChange(u.id, 'suspended')}
                          >
                            Suspend
                          </Button>
                        ) : null}
                        {u.status === 'suspended' && !isSelf ? (
                          <Button
                            size="xs"
                            variant="light"
                            leftSection={<IconUserCheck size={14} />}
                            loading={busy}
                            onClick={() => onStatusChange(u.id, 'approved')}
                          >
                            Reinstate
                          </Button>
                        ) : null}
                        {u.status === 'suspended' && !isSelf ? (
                          <Button
                            size="xs"
                            variant="subtle"
                            leftSection={<IconClock size={14} />}
                            loading={busy}
                            onClick={() => onStatusChange(u.id, 'pending')}
                          >
                            Set pending
                          </Button>
                        ) : null}
                        {isSelf ? (
                          <Text size="xs" c="dimmed">
                            (you)
                          </Text>
                        ) : null}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </Paper>
    </Stack>
  );
}
