/**
 * Settings → API keys: machine-to-machine aim_sk_… keys.
 * Create/delete are owner/admin only (matches backend requireRole).
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Stack,
  Paper,
  Text,
  Group,
  Button,
  Code,
  TextInput,
  Table,
  Modal,
  Loader,
  CopyButton,
  Alert,
} from '@mantine/core';
import { IconKey, IconCopy, IconCheck, IconTrash, IconInfoCircle } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import * as api from '../../services/api';
import { isAdminRole } from '../../lib/roles';
import type { ApiKey } from '../../types/api';

export function ApiKeysTab({ workspaceRole }: { workspaceRole?: string | null }) {
  const canManage = isAdminRole(workspaceRole);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [secretModal, setSecretModal] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.listApiKeys();
      setKeys(data.apiKeys || []);
    } catch (err) {
      notifications.show({
        title: 'Could not load API keys',
        message: err instanceof Error ? err.message : 'Request failed',
        color: 'red',
      });
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    if (!canManage) return;
    const n = name.trim();
    if (!n) {
      notifications.show({ title: 'Name required', message: 'Enter a label for this key.', color: 'yellow' });
      return;
    }
    try {
      setCreating(true);
      const data = await api.createApiKey(n);
      setName('');
      setSecretModal(data.secret || null);
      notifications.show({
        title: 'API key created',
        message: 'Copy the secret now — it is not shown again.',
        color: 'green',
      });
      await load();
    } catch (err) {
      notifications.show({
        title: 'Create failed',
        message: err instanceof Error ? err.message : 'Request failed',
        color: 'red',
      });
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!canManage) return;
    try {
      setRevokingId(id);
      await api.deleteApiKey(id);
      notifications.show({ title: 'Key deleted', message: 'API key removed', color: 'green' });
      await load();
    } catch (err) {
      notifications.show({
        title: 'Delete failed',
        message: err instanceof Error ? err.message : 'Request failed',
        color: 'red',
      });
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <>
      <Paper p="md" withBorder>
        <Stack gap="md">
          <Group justify="space-between">
            <div>
              <Text fw={600} size="sm">
                Integration API keys
              </Text>
              <Text size="xs" c="dimmed" maw={640}>
                Use for server-to-server or other apps calling this API. Send{' '}
                <Code>Authorization: Bearer &lt;aim_sk_…&gt;</Code> and <Code>X-Workspace-Id</Code> with this
                workspace&apos;s UUID. The secret is only shown once when created.
              </Text>
            </div>
            <IconKey size={20} opacity={0.5} />
          </Group>

          {!canManage && (
            <Alert icon={<IconInfoCircle size={18} />} color="blue" variant="light">
              Only workspace owners and admins can create or delete integration API keys.
            </Alert>
          )}

          {loading ? (
            <Group justify="center" p="md">
              <Loader size="sm" />
            </Group>
          ) : (
            <>
              {canManage && (
                <Group align="flex-end" gap="sm" wrap="wrap">
                  <TextInput
                    label="New key name"
                    description="e.g. Production worker, CI, partner integration"
                    placeholder="Integration name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    style={{ flex: '1 1 220px' }}
                  />
                  <Button onClick={handleCreate} loading={creating} size="sm">
                    Generate key
                  </Button>
                </Group>
              )}

              {keys.length === 0 ? (
                <Text size="sm" c="dimmed">
                  No keys yet. Generate one to get an <Code>aim_sk_</Code> secret.
                </Text>
              ) : (
                <Table striped highlightOnHover withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Prefix</Table.Th>
                      <Table.Th>Created</Table.Th>
                      <Table.Th>Last used</Table.Th>
                      {canManage && <Table.Th w={100} />}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {keys.map((k) => (
                      <Table.Tr key={k.id}>
                        <Table.Td>
                          <Text size="sm" fw={500}>
                            {k.name}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Code>{k.key_prefix}…</Code>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {k.created_at ? new Date(k.created_at).toLocaleString() : '—'}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : '—'}
                          </Text>
                        </Table.Td>
                        {canManage && (
                          <Table.Td>
                            <Button
                              variant="subtle"
                              color="red"
                              size="xs"
                              leftSection={<IconTrash size={14} />}
                              loading={revokingId === k.id}
                              onClick={() => handleRevoke(k.id)}
                              aria-label={`Delete API key ${k.name}`}
                            >
                              Delete
                            </Button>
                          </Table.Td>
                        )}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </>
          )}
        </Stack>
      </Paper>

      <Modal opened={Boolean(secretModal)} onClose={() => setSecretModal(null)} title="Your new API secret" size="lg">
        <Stack gap="sm">
          <Text size="sm" c="red" fw={500}>
            Copy this now. It will not be shown again.
          </Text>
          <Code block style={{ wordBreak: 'break-all', fontSize: 12 }}>
            {secretModal}
          </Code>
          <CopyButton value={secretModal || ''}>
            {({ copied, copy }) => (
              <Button
                leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                color={copied ? 'teal' : undefined}
                onClick={copy}
              >
                {copied ? 'Copied' : 'Copy secret'}
              </Button>
            )}
          </CopyButton>
        </Stack>
      </Modal>
    </>
  );
}
