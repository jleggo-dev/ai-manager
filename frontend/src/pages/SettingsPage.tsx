/**
 * Page – AI Admin Settings
 * -------------------------
 * Configuration for the AI Admin application:
 *   - System: health check and API connectivity
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Stack,
  Paper,
  Text,
  Badge,
  Group,
  Button,
  Code,
  NumberInput,
  TextInput,
  Select,
  Table,
  Modal,
  Loader,
  CopyButton,
  Tabs,
  Alert,
} from '@mantine/core';
import {
  IconRefresh,
  IconClock,
  IconKey,
  IconCopy,
  IconCheck,
  IconTrash,
  IconAdjustments,
  IconUserCog,
  IconShieldLock,
  IconShield,
  IconDatabase,
  IconAlertTriangle,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import PageHeader from '../components/atoms/PageHeader';
import * as api from '../services/api';
import type { HealthCheckResult, ApiKey, Provider, UserCredential } from '../types/api';

/* ══════════════════════════════════════════════════════════════
   SYSTEM TAB — Health check
   ══════════════════════════════════════════════════════════════ */

function SystemTab() {
  const [health, setHealth] = useState<(HealthCheckResult & { error?: string }) | null>(null);
  const [loading, setLoading] = useState(true);

  async function checkHealth() {
    try {
      setLoading(true);
      const data = await api.healthCheck();
      setHealth(data);
    } catch (err) {
      setHealth({ status: 'error', tables: {}, error: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    checkHealth();
  }, []);

  return (
    <Stack gap="md">
      <Paper p="md" withBorder>
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={600} size="sm">
              API Health
            </Text>
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconRefresh size={14} />}
              onClick={checkHealth}
              loading={loading}
            >
              Refresh
            </Button>
          </Group>
          <Group gap="sm">
            <Text size="sm">Backend Status:</Text>
            <Badge color={health?.status === 'ok' ? 'green' : 'red'} variant="light">
              {health?.status || 'checking...'}
            </Badge>
          </Group>
          {health?.error && <Code color="red">{health.error}</Code>}
        </Stack>
      </Paper>

      <Paper p="md" withBorder>
        <Stack gap="sm">
          <Text fw={600} size="sm">
            Configuration Notes
          </Text>
          <Text size="sm" c="dimmed">
            LLM model selection is managed through the Admin section:
          </Text>
          <Text size="sm">
            1. Add a <strong>Provider</strong> (e.g. Devs.ai) with your API credentials.
          </Text>
          <Text size="sm">
            2. Create an <strong>AI Profile</strong> that references a specific AI from the provider.
          </Text>
          <Text size="sm">
            3. Create a <strong>Processing Job</strong> (e.g. &quot;Company Profiling&quot;) and assign the AI profile
            to it.
          </Text>
          <Text size="sm" c="dimmed" mt="xs">
            The profiling pipeline will automatically use the AI assigned to the &quot;company-profiling&quot; job. If
            no job is configured, it falls back to the environment variable defaults.
          </Text>
        </Stack>
      </Paper>
    </Stack>
  );
}

/* ══════════════════════════════════════════════════════════════
   LLM DEFAULTS — System-wide timeout
   ══════════════════════════════════════════════════════════════ */

function LlmDefaultsTab() {
  const [timeoutMs, setTimeoutMs] = useState(300000);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const setting = await api.getSettingByKey('default_llm_timeout_ms');
        if (setting?.value?.value) setTimeoutMs(Number(setting.value.value));
      } catch (_err) {
        /* setting may not exist yet */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave() {
    try {
      setSaving(true);
      await api.upsertSetting(
        'default_llm_timeout_ms',
        { value: timeoutMs },
        'System-wide default timeout (ms) for LLM completion API calls.',
      );
      notifications.show({
        title: 'Saved',
        message: `Default LLM timeout set to ${(timeoutMs / 1000).toFixed(0)}s`,
        color: 'green',
      });
    } catch (err) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : 'Save failed', color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Paper p="md" withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <div>
            <Text fw={600} size="sm">
              Default LLM Timeout
            </Text>
            <Text size="xs" c="dimmed">
              System-wide timeout for LLM completion calls. Individual providers and processing jobs can override this
              value.
            </Text>
          </div>
          <IconClock size={18} opacity={0.5} />
        </Group>
        <Group align="flex-end" gap="sm">
          <NumberInput
            label="Timeout (ms)"
            description={`${((timeoutMs || 0) / 1000).toFixed(0)} seconds = ${((timeoutMs || 0) / 60000).toFixed(1)} minutes`}
            value={timeoutMs}
            onChange={(val) => setTimeoutMs(Number(val) || 0)}
            min={5000}
            max={600000}
            step={5000}
            disabled={loading}
            style={{ flex: 1 }}
          />
          <Button onClick={handleSave} loading={saving} disabled={loading} size="sm">
            Save
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

/* ══════════════════════════════════════════════════════════════
   RATE LIMITS — Configurable per-minute request limits
   ══════════════════════════════════════════════════════════════ */

const RATE_LIMIT_FIELDS = [
  {
    key: 'rate_limit_global_rpm',
    label: 'Global',
    description: 'All API endpoints combined',
    min: 10,
    max: 10000,
    step: 10,
    defaultVal: 200,
  },
  {
    key: 'rate_limit_llm_rpm',
    label: 'AI endpoints (per IP)',
    description: 'Chat sessions and AI matcher — per IP address',
    min: 5,
    max: 1000,
    step: 5,
    defaultVal: 30,
  },
  {
    key: 'rate_limit_llm_user_rpm',
    label: 'Per-user AI',
    description: 'AI endpoints per forwarded user (multi-tenant). 0 = off.',
    min: 0,
    max: 200,
    step: 5,
    defaultVal: 15,
  },
  {
    key: 'rate_limit_auth_rpm',
    label: 'Auth endpoints',
    description: 'Login and bootstrap calls',
    min: 5,
    max: 100,
    step: 5,
    defaultVal: 15,
  },
];

function RateLimitsTab() {
  const [values, setValues] = useState(() => Object.fromEntries(RATE_LIMIT_FIELDS.map((f) => [f.key, f.defaultVal])));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const results = await Promise.all(RATE_LIMIT_FIELDS.map((f) => api.getSettingByKey(f.key).catch(() => null)));
        const loaded: Record<string, number> = {};
        RATE_LIMIT_FIELDS.forEach((f, i) => {
          loaded[f.key] = Number(results[i]?.value?.value) || f.defaultVal;
        });
        setValues(loaded);
      } catch (_err) {
        /* use defaults */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave() {
    try {
      setSaving(true);
      await Promise.all(
        RATE_LIMIT_FIELDS.map((f) => api.upsertSetting(f.key, { value: values[f.key] }, f.description)),
      );
      notifications.show({
        title: 'Saved',
        message: 'Rate limits updated. Changes take effect within 60 seconds.',
        color: 'green',
      });
    } catch (err) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : 'Save failed', color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Paper p="md" withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <div>
            <Text fw={600} size="sm">
              Rate Limits
            </Text>
            <Text size="xs" c="dimmed">
              Maximum requests per minute per IP address. Changes take effect within 60 seconds.
            </Text>
          </div>
          <IconShield size={18} opacity={0.5} />
        </Group>
        <Group align="flex-end" gap="sm" wrap="wrap">
          {RATE_LIMIT_FIELDS.map((f) => (
            <NumberInput
              key={f.key}
              label={`${f.label} (rpm)`}
              description={f.description}
              value={values[f.key]}
              onChange={(val) => setValues((prev) => ({ ...prev, [f.key]: Number(val) || 0 }))}
              min={f.min}
              max={f.max}
              step={f.step}
              disabled={loading}
              style={{ flex: '1 1 160px' }}
            />
          ))}
          <Button onClick={handleSave} loading={saving} disabled={loading} size="sm">
            Save
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

/* ══════════════════════════════════════════════════════════════
   API KEYS — Machine-to-machine access (aim_sk_…)
   ══════════════════════════════════════════════════════════════ */

function BackendUrlCard() {
  const backendUrl = `${window.location.origin}/_/backend`;

  return (
    <Paper p="md" withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <div>
            <Text fw={600} size="sm">
              Backend API URL
            </Text>
            <Text size="xs" c="dimmed" maw={640}>
              Use this as <Code>AI_ADMIN_BASE_URL</Code> in your Supabase Edge Function secrets. All API routes are
              relative to this base.
            </Text>
          </div>
        </Group>
        <Group gap="sm">
          <Code block style={{ flex: 1, fontSize: 13, padding: '8px 12px' }}>
            {backendUrl}
          </Code>
          <CopyButton value={backendUrl}>
            {({ copied, copy }) => (
              <Button
                variant="light"
                size="sm"
                leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                color={copied ? 'teal' : undefined}
                onClick={copy}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            )}
          </CopyButton>
        </Group>
      </Stack>
    </Paper>
  );
}

function ApiKeysTab({ workspaceRole: _workspaceRole }: { workspaceRole?: string | null }) {
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

          {loading ? (
            <Group justify="center" p="md">
              <Loader size="sm" />
            </Group>
          ) : (
            <>
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
                      <Table.Th w={100} />
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
                        <Table.Td>
                          <Button
                            variant="subtle"
                            color="red"
                            size="xs"
                            leftSection={<IconTrash size={14} />}
                            loading={revokingId === k.id}
                            onClick={() => handleRevoke(k.id)}
                          >
                            Delete
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

/* ══════════════════════════════════════════════════════════════
   MY CREDENTIALS — Per-user LLM provider keys (e.g. Devs.ai)
   ══════════════════════════════════════════════════════════════ */

function UserCredentialsTab() {
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

/* ══════════════════════════════════════════════════════════════
   DATA MANAGEMENT — GDPR / CCPA compliance deletion
   ══════════════════════════════════════════════════════════════ */

type DeletionScope = 'all' | 'sessions' | 'diagnostic-logs' | 'credentials';

const SCOPE_OPTIONS: { value: DeletionScope; label: string }[] = [
  { value: 'all', label: 'All data (sessions, logs, credentials)' },
  { value: 'sessions', label: 'Chat sessions only' },
  { value: 'diagnostic-logs', label: 'Diagnostic logs only' },
  { value: 'credentials', label: 'Provider credentials only' },
];

function DataManagementTab() {
  const [userId, setUserId] = useState('');
  const [scope, setScope] = useState<DeletionScope>('all');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  function handleInitiateDelete() {
    const trimmed = userId.trim();
    if (!trimmed) {
      notifications.show({ title: 'Required', message: 'Enter a user ID to proceed.', color: 'yellow' });
      return;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
      notifications.show({ title: 'Invalid ID', message: 'User ID must be a valid UUID.', color: 'yellow' });
      return;
    }
    setConfirmText('');
    setConfirmOpen(true);
  }

  async function handleConfirmedDelete() {
    try {
      setDeleting(true);
      const result = await api.deleteUserData(userId.trim(), scope);
      const counts = result.deleted;
      const parts: string[] = [];
      if (counts.sessions != null) parts.push(`${counts.sessions} session(s)`);
      if (counts.diagnosticLogs != null) parts.push(`${counts.diagnosticLogs} log(s)`);
      if (counts.credentials != null) parts.push(`${counts.credentials} credential(s)`);
      notifications.show({
        title: 'Data deleted',
        message: `Removed: ${parts.join(', ') || 'no matching records'}.`,
        color: 'green',
      });
      setConfirmOpen(false);
      setUserId('');
      setConfirmText('');
    } catch (err) {
      notifications.show({
        title: 'Deletion failed',
        message: err instanceof Error ? err.message : 'Request failed',
        color: 'red',
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Stack gap="md">
        <Alert icon={<IconAlertTriangle size={18} />} color="orange" variant="light" title="Compliance Data Deletion">
          <Text size="sm">
            Use this tool to permanently delete a user&apos;s data from this workspace in compliance with GDPR, CCPA, or
            internal data retention policies. This action is <strong>irreversible</strong>.
          </Text>
        </Alert>

        <Paper p="md" withBorder>
          <Stack gap="sm">
            <Group gap="sm">
              <IconDatabase size={20} opacity={0.6} />
              <div>
                <Text fw={600} size="sm">
                  Delete User Data
                </Text>
                <Text size="xs" c="dimmed" maw={640}>
                  Enter the target user&apos;s UUID and select which data to remove. You will be asked to type a
                  confirmation string before deletion proceeds.
                </Text>
              </div>
            </Group>

            <Group align="flex-end" gap="sm" wrap="wrap">
              <TextInput
                label="User ID"
                description="UUID of the user whose data should be deleted"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                style={{ flex: '2 1 300px' }}
              />
              <Select
                label="Scope"
                description="Which data to delete"
                data={SCOPE_OPTIONS}
                value={scope}
                onChange={(v) => setScope((v as DeletionScope) || 'all')}
                style={{ flex: '1 1 220px' }}
              />
              <Button color="red" variant="outline" onClick={handleInitiateDelete} size="sm">
                Delete data…
              </Button>
            </Group>
          </Stack>
        </Paper>
      </Stack>

      <Modal opened={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm irreversible deletion" size="md">
        <Stack gap="sm">
          <Text size="sm">
            You are about to permanently delete <strong>{scope === 'all' ? 'all data' : scope}</strong> for user{' '}
            <Code>{userId.trim()}</Code> in this workspace.
          </Text>
          <Text size="sm" c="red" fw={500}>
            This cannot be undone. Type DELETE below to confirm.
          </Text>
          <TextInput
            placeholder="Type DELETE to confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            error={confirmText.length > 0 && confirmText !== 'DELETE' ? 'Must type exactly DELETE' : undefined}
          />
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button color="red" onClick={handleConfirmedDelete} loading={deleting} disabled={confirmText !== 'DELETE'}>
              Permanently delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   SETTINGS PAGE — AI Admin
   ══════════════════════════════════════════════════════════════ */

interface SettingsPageProps {
  onNavigate: (key: string, params?: Record<string, unknown>) => void;
  pageParams: Record<string, unknown>;
  workspaceRole?: string | null;
}

export default function SettingsPage({ workspaceRole, pageParams }: SettingsPageProps) {
  const validTabs = ['general', 'api-keys', 'my-credentials', 'data-management'];
  const tabParam = typeof pageParams?.tab === 'string' ? pageParams.tab : null;
  const initialTab = tabParam && validTabs.includes(tabParam) ? tabParam : 'general';

  return (
    <Stack gap="md">
      <PageHeader title="Settings" description="System configuration, integration keys, and personal credentials" />
      <Tabs key={initialTab} defaultValue={initialTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="general" leftSection={<IconAdjustments size={16} />}>
            General
          </Tabs.Tab>
          <Tabs.Tab value="api-keys" leftSection={<IconKey size={16} />}>
            API keys
          </Tabs.Tab>
          <Tabs.Tab value="my-credentials" leftSection={<IconUserCog size={16} />}>
            My Credentials
          </Tabs.Tab>
          <Tabs.Tab value="data-management" leftSection={<IconDatabase size={16} />}>
            Data Management
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="general" pt="md">
          <Stack gap="md">
            <SystemTab />
            <LlmDefaultsTab />
            <RateLimitsTab />
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="api-keys" pt="md">
          <Stack gap="md">
            <BackendUrlCard />
            <ApiKeysTab workspaceRole={workspaceRole} />
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="my-credentials" pt="md">
          <UserCredentialsTab />
        </Tabs.Panel>

        <Tabs.Panel value="data-management" pt="md">
          <DataManagementTab />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
