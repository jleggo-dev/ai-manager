/**
 * Settings → My Credentials: per-user LLM provider keys.
 */

import { useState, useEffect, useCallback } from 'react';
import { Stack, Paper, Text, Group, Button, TextInput, Select, Table, Loader } from '@mantine/core';
import { IconTrash, IconShieldLock } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import * as api from '../../services/api';
import type { Provider, UserCredential } from '../../types/api';

export function UserCredentialsTab() {
  const [credentials, setCredentials] = useState<UserCredential[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [label, setLabel] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [credsResult, provsResult] = await Promise.allSettled([api.listUserCredentials(), api.listProviders()]);
      setCredentials(credsResult.status === 'fulfilled' ? credsResult.value || [] : []);
      setProviders(provsResult.status === 'fulfilled' ? provsResult.value?.data || [] : []);
      if (credsResult.status === 'rejected' && provsResult.status === 'rejected') {
        notifications.show({ title: 'Error', message: 'Failed to load credentials and providers.', color: 'red' });
      }
    } catch (err) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : 'Load failed', color: 'red' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const providerOptions = providers.map((p) => ({
    value: p.id,
    label: `${p.name} (${p.type})`,
  }));

  function providerName(providerId: string) {
    const p = providers.find((pr) => pr.id === providerId);
    return p ? `${p.name} (${p.type})` : providerId;
  }

  async function handleSave() {
    if (!selectedProvider || !apiKey.trim()) {
      notifications.show({ title: 'Required', message: 'Select a provider and enter an API key.', color: 'yellow' });
      return;
    }
    const trimmedKey = apiKey.trim();
    if (trimmedKey.length < 8) {
      notifications.show({
        title: 'Invalid key',
        message: 'API key is too short (minimum 8 characters).',
        color: 'yellow',
      });
      return;
    }
    if (/\s/.test(trimmedKey)) {
      notifications.show({
        title: 'Invalid key',
        message: 'API key should not contain spaces or newlines. Make sure you only pasted the key.',
        color: 'yellow',
      });
      return;
    }
    try {
      setSaving(true);
      await api.upsertUserCredential(selectedProvider, trimmedKey, label.trim() || undefined);
      notifications.show({
        title: 'Saved',
        message: 'Your credential has been stored (encrypted at rest).',
        color: 'green',
      });
      setApiKey('');
      setLabel('');
      setSelectedProvider(null);
      await load();
    } catch (err) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : 'Save failed', color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteUserCredential(id);
      notifications.show({ title: 'Removed', message: 'Credential deleted.', color: 'orange' });
      await load();
    } catch (err) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : 'Delete failed',
        color: 'red',
      });
    }
  }

  return (
    <Stack gap="md">
      <Paper p="md" withBorder>
        <Stack gap="sm">
          <Group gap="sm">
            <IconShieldLock size={20} opacity={0.6} />
            <div>
              <Text fw={600} size="sm">
                Personal Provider Credentials
              </Text>
              <Text size="xs" c="dimmed" maw={640}>
                Store your own API key for a provider (e.g. your personal Devs.ai key). When set, AI Admin uses your key
                instead of the shared workspace key, so MCP OAuth tokens (Google Drive, Gmail, etc.) are scoped to your
                account. Keys are encrypted with AES-256-GCM before storage.
              </Text>
            </div>
          </Group>

          {loading ? (
            <Group justify="center" p="md">
              <Loader size="sm" />
            </Group>
          ) : (
            <>
              <Group align="flex-end" gap="sm" wrap="wrap">
                <Select
                  label="Provider"
                  placeholder="Select a provider"
                  data={providerOptions}
                  value={selectedProvider}
                  onChange={setSelectedProvider}
                  style={{ flex: '1 1 200px' }}
                />
                <TextInput
                  label="API Key"
                  placeholder="sk-…"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  style={{ flex: '2 1 260px' }}
                />
                <TextInput
                  label="Label (optional)"
                  placeholder="e.g. My personal key"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  style={{ flex: '1 1 160px' }}
                />
                <Button onClick={handleSave} loading={saving} size="sm">
                  Save
                </Button>
              </Group>

              {credentials.length === 0 ? (
                <Text size="sm" c="dimmed" mt="xs">
                  No personal credentials stored. Add one above to enable per-user MCP integrations.
                </Text>
              ) : (
                <Table striped highlightOnHover withTableBorder mt="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Provider</Table.Th>
                      <Table.Th>Label</Table.Th>
                      <Table.Th>Added</Table.Th>
                      <Table.Th w={100} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {credentials.map((c) => (
                      <Table.Tr key={c.id}>
                        <Table.Td>
                          <Text size="sm">{providerName(c.provider_id)}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed">
                            {c.label || '—'}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Button
                            variant="subtle"
                            color="red"
                            size="xs"
                            leftSection={<IconTrash size={14} />}
                            onClick={() => handleDelete(c.id)}
                          >
                            Remove
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
