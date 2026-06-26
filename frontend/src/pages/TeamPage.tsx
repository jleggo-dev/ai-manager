/**
 * Page – Workspace team members (list + role changes for owner/admin).
 */

import { useState, useEffect, useCallback } from 'react';
import { Stack, Paper, Table, Text, Select, Badge, Group, Loader, Alert } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import PageHeader from '../components/atoms/PageHeader';
import * as api from '../services/api';
import type { WorkspaceMember } from '../types/api';
import { getWorkspaceId, getSessionUser } from '../lib/auth-session';
import { isAdminRole } from '../lib/roles';

const ROLE_OPTIONS = ['owner', 'admin', 'member'].map((r) => ({ value: r, label: r }));

export default function TeamPage() {
  const workspaceId = getWorkspaceId();
  const selfId = getSessionUser()?.id;
  /** Resolved from API so admins are not gated on parent render timing. */
  const [viewerWorkspaceRole, setViewerWorkspaceRole] = useState<string | null>(null);
  const canManage = isAdminRole(viewerWorkspaceRole);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setMembers([]);
      setViewerWorkspaceRole(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const [wsRes, memRes] = await Promise.all([api.listWorkspaces(), api.listWorkspaceMembers(workspaceId)]);
      const myMembership = wsRes.workspaces?.find((w) => w.workspace_id === workspaceId);
      setViewerWorkspaceRole(myMembership?.role ?? null);
      setMembers(memRes.members || []);
    } catch (err) {
      notifications.show({
        title: 'Could not load team',
        message: err instanceof Error ? err.message : 'Request failed',
        color: 'red',
      });
      setMembers([]);
      setViewerWorkspaceRole(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const onRoleChange = async (memberUserId: string, newRole: string) => {
    if (!workspaceId || !canManage) return;
    try {
      setUpdatingId(memberUserId);
      await api.updateWorkspaceMemberRole(workspaceId, memberUserId, newRole);
      notifications.show({ title: 'Role updated', message: newRole, color: 'green' });
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
        <PageHeader title="Team" description="Choose a workspace to see members." />
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <PageHeader
        title="Team"
        description={
          canManage
            ? 'People in this workspace. Owners and admins can assign roles (member, admin, owner) for access control.'
            : 'People in this workspace. Ask an owner or admin to change roles.'
        }
      />

      {canManage ? (
        <Alert variant="light" color="blue" icon={<IconInfoCircle size={18} />} title="Manage roles">
          Use the <strong>Role</strong> dropdown for each member to set <strong>member</strong>, <strong>admin</strong>,
          or <strong>owner</strong>. Your own row shows a badge only — have another owner or admin change your role if
          needed.
        </Alert>
      ) : null}

      <Paper p="md" withBorder>
        {loading ? (
          <Group justify="center" p="xl">
            <Loader size="sm" />
          </Group>
        ) : members.length === 0 ? (
          <Text size="sm" c="dimmed">
            No members found.
          </Text>
        ) : (
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>User ID</Table.Th>
                <Table.Th>Role</Table.Th>
                <Table.Th>Last Login</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {members.map((m) => {
                const label = m.display_name?.trim() || '—';
                const busy = updatingId === m.user_id;
                return (
                  <Table.Tr key={m.user_id}>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {label}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" ff="monospace" c="dimmed">
                        {m.user_id}
                      </Text>
                    </Table.Td>
                    <Table.Td w={220}>
                      {canManage && m.user_id !== selfId ? (
                        <Select
                          size="xs"
                          aria-label={`Set role for member ${m.user_id}`}
                          data={ROLE_OPTIONS}
                          value={m.role}
                          allowDeselect={false}
                          disabled={busy}
                          comboboxProps={{ withinPortal: true }}
                          onChange={(v) => v && onRoleChange(m.user_id, v)}
                        />
                      ) : (
                        <Badge variant="light" size="sm">
                          {m.role}
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {m.last_sign_in_at ? new Date(m.last_sign_in_at).toLocaleString() : 'Never'}
                      </Text>
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
