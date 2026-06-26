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
  NumberInput,
  Switch,
  Alert,
  ActionIcon,
  Tooltip,
  Collapse,
  Anchor,
  Box,
  Card,
  SimpleGrid,
  Title,
  Divider,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconWorldWww,
  IconPlus,
  IconEdit,
  IconTrash,
  IconPlayerPlay,
  IconChevronDown,
  IconChevronUp,
  IconAlertCircle,
  IconSettings,
} from '@tabler/icons-react';
import PageHeader from '../components/atoms/PageHeader';
import InvestigationPanel from '../components/InvestigationPanel';
import * as api from '../services/api';
import type { WidgetHcCheck, WidgetHcTimeouts } from '../types/api';
import { HEALTH_STATUS_CONFIG } from '../constants/healthStatus';

interface HealthCheckWidgetPageProps {
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

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

const STATUS_COLORS: Record<string, string> = {
  pass: 'green',
  warning: 'yellow',
  fail: 'red',
  timeout: 'orange',
  error: 'red',
};

interface FormState {
  name: string;
  url: string;
  test_message: string;
  cadence_minutes: number;
  outage_cadence_minutes: number;
  is_active: boolean;
  max_retries: number;
  shadow_host_selector: string;
  launcher_selector: string;
  iframe_selector: string;
  input_selector: string;
  send_selector: string;
  response_selector: string;
  error_patterns: string;
  page_load_timeout_ms: number | null;
  widget_load_timeout_ms: number | null;
  response_timeout_ms: number | null;
  capture_screenshot: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  url: '',
  test_message: 'Hello, can you help me?',
  cadence_minutes: 15,
  outage_cadence_minutes: 2,
  is_active: true,
  max_retries: 1,
  shadow_host_selector: '#appdirect-ai-embedded-root',
  launcher_selector: 'button[class*="appdirect-ai-Button"]',
  iframe_selector: 'iframe[class*="appdirect-ai-Iframe"]',
  input_selector: '#chat-input, textarea',
  send_selector: 'div[class*="inputBackground"] button:last-of-type, button.mantine-ActionIcon-root:last-of-type',
  response_selector: '.markdown-chat-message, [class*="chat-message"]',
  error_patterns: '',
  page_load_timeout_ms: null,
  widget_load_timeout_ms: null,
  response_timeout_ms: null,
  capture_screenshot: true,
};

const DEFAULT_GLOBAL_TIMEOUTS: WidgetHcTimeouts = {
  page_load_timeout_ms: 60000,
  widget_load_timeout_ms: 30000,
  response_timeout_ms: 60000,
  slow_page_load_ms: 15000,
  slow_widget_load_ms: 10000,
  slow_response_ms: 30000,
};

export default function HealthCheckWidgetPage(_props: HealthCheckWidgetPageProps) {
  const [checks, setChecks] = useState<WidgetHcCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpened, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure(false);
  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingCheck, setDeletingCheck] = useState<WidgetHcCheck | null>(null);
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [runningId, setRunningId] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [globalTimeouts, setGlobalTimeouts] = useState<WidgetHcTimeouts>(DEFAULT_GLOBAL_TIMEOUTS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const loadGlobalTimeouts = useCallback(async () => {
    try {
      const t = await api.getWidgetHcGlobalTimeouts();
      setGlobalTimeouts(t);
    } catch {
      /* use defaults */
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [res] = await Promise.all([api.listWidgetHcChecks(), loadGlobalTimeouts()]);
      setChecks(res.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load widget health checks');
    } finally {
      setLoading(false);
    }
  }, [loadGlobalTimeouts]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleExpand = useCallback((checkId: string) => {
    setExpandedId((prev) => (prev === checkId ? null : checkId));
  }, []);

  function formToPayload(f: FormState): Partial<WidgetHcCheck> {
    return {
      name: f.name,
      url: f.url,
      test_message: f.test_message,
      cadence_minutes: f.cadence_minutes,
      outage_cadence_minutes: f.outage_cadence_minutes,
      is_active: f.is_active,
      max_retries: f.max_retries,
      shadow_host_selector: f.shadow_host_selector,
      launcher_selector: f.launcher_selector,
      iframe_selector: f.iframe_selector,
      input_selector: f.input_selector,
      send_selector: f.send_selector,
      response_selector: f.response_selector,
      error_patterns: f.error_patterns
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      page_load_timeout_ms: f.page_load_timeout_ms,
      widget_load_timeout_ms: f.widget_load_timeout_ms,
      response_timeout_ms: f.response_timeout_ms,
      capture_screenshot: f.capture_screenshot,
    };
  }

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await api.saveWidgetHcGlobalTimeouts(globalTimeouts);
      notifications.show({ title: 'Saved', message: 'Global timeout settings updated', color: 'green' });
    } catch (err: unknown) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : 'Failed to save settings',
        color: 'red',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      await api.createWidgetHcCheck(formToPayload(form));
      notifications.show({ title: 'Created', message: 'Widget check created successfully', color: 'green' });
      closeCreate();
      setForm(EMPTY_FORM);
      setAdvancedOpen(false);
      await loadData();
    } catch (err: unknown) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : 'Failed to create',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEditOpen = (check: WidgetHcCheck) => {
    setEditingId(check.id);
    setForm({
      name: check.name ?? '',
      url: check.url ?? '',
      test_message: check.test_message ?? 'Hello, can you help me?',
      cadence_minutes: check.cadence_minutes ?? 15,
      outage_cadence_minutes: check.outage_cadence_minutes ?? 2,
      is_active: check.is_active ?? true,
      max_retries: check.max_retries ?? 1,
      shadow_host_selector: check.shadow_host_selector ?? '#appdirect-ai-embedded-root',
      launcher_selector: check.launcher_selector ?? 'button[class*="appdirect-ai-Button"]',
      iframe_selector: check.iframe_selector ?? 'iframe[class*="appdirect-ai-Iframe"]',
      input_selector: check.input_selector ?? '#chat-input, textarea',
      send_selector:
        check.send_selector ??
        'div[class*="inputBackground"] button:last-of-type, button.mantine-ActionIcon-root:last-of-type',
      response_selector: check.response_selector ?? '.markdown-chat-message, [class*="chat-message"]',
      error_patterns: (check.error_patterns || []).join('\n'),
      page_load_timeout_ms: check.page_load_timeout_ms,
      widget_load_timeout_ms: check.widget_load_timeout_ms,
      response_timeout_ms: check.response_timeout_ms,
      capture_screenshot: check.capture_screenshot ?? true,
    });
    setAdvancedOpen(false);
    openEdit();
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await api.updateWidgetHcCheck(editingId, formToPayload(form));
      notifications.show({ title: 'Updated', message: 'Widget check updated successfully', color: 'green' });
      closeEdit();
      setForm(EMPTY_FORM);
      setEditingId(null);
      setAdvancedOpen(false);
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

  const handleDeleteOpen = (check: WidgetHcCheck) => {
    setDeletingCheck(check);
    openDelete();
  };

  const handleDelete = async () => {
    if (!deletingCheck) return;
    setSaving(true);
    try {
      await api.deleteWidgetHcCheck(deletingCheck.id);
      notifications.show({ title: 'Deleted', message: 'Widget check deleted', color: 'green' });
      closeDelete();
      setDeletingCheck(null);
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
    setRunningId(id);
    try {
      const result = await api.runWidgetHcCheck(id);
      notifications.show({
        title: 'Run Complete',
        message: `Status: ${result.status}${result.response_time_ms ? ` (${result.response_time_ms}ms)` : ''}`,
        color: STATUS_COLORS[result.status] || 'gray',
      });
      await loadData();
    } catch (err: unknown) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : 'Failed to run check',
        color: 'red',
      });
    } finally {
      setRunningId(null);
    }
  };

  if (loading) {
    return (
      <Stack>
        <PageHeader title="Widget Health" />
        <Center py="xl">
          <Loader />
        </Center>
      </Stack>
    );
  }

  if (error) {
    return (
      <Stack>
        <PageHeader title="Widget Health" />
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
        placeholder="e.g. Marketing site widget"
        value={form.name ?? ''}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setForm((f) => ({ ...f, name: v }));
        }}
        required
      />
      <TextInput
        label="URL"
        placeholder="https://example.com"
        value={form.url ?? ''}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setForm((f) => ({ ...f, url: v }));
        }}
        required
      />
      <Textarea
        label="Test Message"
        placeholder="Message sent through the widget for health verification"
        value={form.test_message ?? ''}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setForm((f) => ({ ...f, test_message: v }));
        }}
        minRows={2}
        required
      />
      <NumberInput
        label="Cadence (minutes)"
        min={1}
        max={1440}
        value={form.cadence_minutes ?? 15}
        onChange={(val) => setForm((f) => ({ ...f, cadence_minutes: typeof val === 'number' ? val : 15 }))}
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
      <NumberInput
        label="Max Retries"
        min={1}
        max={3}
        value={form.max_retries ?? 1}
        onChange={(val) => setForm((f) => ({ ...f, max_retries: typeof val === 'number' ? val : 1 }))}
      />
      <Switch
        label="Active"
        checked={form.is_active ?? true}
        onChange={(e) => {
          const v = e.currentTarget.checked;
          setForm((f) => ({ ...f, is_active: v }));
        }}
      />

      <Button
        variant="subtle"
        size="compact-sm"
        onClick={() => setAdvancedOpen((o) => !o)}
        rightSection={advancedOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
      >
        Advanced Settings
      </Button>
      <Collapse in={advancedOpen}>
        <Stack gap="sm">
          <TextInput
            label="Shadow Host Selector"
            description="CSS selector for the shadow DOM host element. Leave empty for widgets not using shadow DOM."
            placeholder="#appdirect-ai-embedded-root"
            value={form.shadow_host_selector ?? ''}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setForm((f) => ({ ...f, shadow_host_selector: v }));
            }}
          />
          <TextInput
            label="Launcher Selector"
            placeholder="CSS selector for launcher button"
            value={form.launcher_selector ?? ''}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setForm((f) => ({ ...f, launcher_selector: v }));
            }}
          />
          <TextInput
            label="Iframe Selector"
            placeholder="CSS selector for widget iframe"
            value={form.iframe_selector ?? ''}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setForm((f) => ({ ...f, iframe_selector: v }));
            }}
          />
          <TextInput
            label="Input Selector"
            placeholder="CSS selector for message input"
            value={form.input_selector ?? ''}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setForm((f) => ({ ...f, input_selector: v }));
            }}
          />
          <TextInput
            label="Send Selector"
            placeholder="CSS selector for send button"
            value={form.send_selector ?? ''}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setForm((f) => ({ ...f, send_selector: v }));
            }}
          />
          <TextInput
            label="Response Selector"
            placeholder="CSS selector for response container"
            value={form.response_selector ?? ''}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setForm((f) => ({ ...f, response_selector: v }));
            }}
          />
          <Textarea
            label="Error Patterns"
            description="One pattern per line"
            placeholder="Something went wrong&#10;Error:"
            value={form.error_patterns ?? ''}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setForm((f) => ({ ...f, error_patterns: v }));
            }}
            minRows={2}
          />

          <Divider label="Timeout Overrides" labelPosition="left" />
          <Text size="xs" c="dimmed">
            Leave blank to use global defaults. Set a value to override for this check only.
          </Text>
          <SimpleGrid cols={3}>
            <NumberInput
              label="Page Load (ms)"
              description={`Global: ${globalTimeouts.page_load_timeout_ms}ms`}
              min={5000}
              step={1000}
              placeholder={`${globalTimeouts.page_load_timeout_ms}`}
              value={form.page_load_timeout_ms ?? ''}
              onChange={(val) => setForm((f) => ({ ...f, page_load_timeout_ms: typeof val === 'number' ? val : null }))}
            />
            <NumberInput
              label="Widget Load (ms)"
              description={`Global: ${globalTimeouts.widget_load_timeout_ms}ms`}
              min={5000}
              step={1000}
              placeholder={`${globalTimeouts.widget_load_timeout_ms}`}
              value={form.widget_load_timeout_ms ?? ''}
              onChange={(val) =>
                setForm((f) => ({ ...f, widget_load_timeout_ms: typeof val === 'number' ? val : null }))
              }
            />
            <NumberInput
              label="AI Response (ms)"
              description={`Global: ${globalTimeouts.response_timeout_ms}ms`}
              min={10000}
              step={1000}
              placeholder={`${globalTimeouts.response_timeout_ms}`}
              value={form.response_timeout_ms ?? ''}
              onChange={(val) => setForm((f) => ({ ...f, response_timeout_ms: typeof val === 'number' ? val : null }))}
            />
          </SimpleGrid>
          <Switch
            label="Capture Screenshot"
            checked={form.capture_screenshot ?? false}
            onChange={(e) => {
              const v = e.currentTarget.checked;
              setForm((f) => ({ ...f, capture_screenshot: v }));
            }}
          />
        </Stack>
      </Collapse>
    </Stack>
  );

  return (
    <Stack>
      <PageHeader title="Widget Health">
        <Group gap="sm">
          <Button variant="light" leftSection={<IconSettings size={16} />} onClick={() => setSettingsOpen((o) => !o)}>
            Global Settings
          </Button>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => {
              setForm(EMPTY_FORM);
              setAdvancedOpen(false);
              openCreate();
            }}
          >
            New Widget Check
          </Button>
        </Group>
      </PageHeader>

      <Collapse in={settingsOpen}>
        <Card withBorder mb="md" p="md">
          <Title order={5} mb="sm">
            Global Timeout Defaults
          </Title>
          <Text size="xs" c="dimmed" mb="md">
            These apply to all widget checks unless overridden at the individual check level.
          </Text>
          <SimpleGrid cols={3} mb="md">
            <NumberInput
              label="Page Load Timeout"
              description="Max time to load the webpage"
              suffix=" ms"
              min={5000}
              max={600000}
              step={5000}
              value={globalTimeouts.page_load_timeout_ms}
              onChange={(val) =>
                setGlobalTimeouts((t) => ({
                  ...t,
                  page_load_timeout_ms: typeof val === 'number' ? val : t.page_load_timeout_ms,
                }))
              }
            />
            <NumberInput
              label="Widget Load Timeout"
              description="Max time for widget to initialize"
              suffix=" ms"
              min={5000}
              max={600000}
              step={5000}
              value={globalTimeouts.widget_load_timeout_ms}
              onChange={(val) =>
                setGlobalTimeouts((t) => ({
                  ...t,
                  widget_load_timeout_ms: typeof val === 'number' ? val : t.widget_load_timeout_ms,
                }))
              }
            />
            <NumberInput
              label="AI Response Timeout"
              description="Max time for AI to reply"
              suffix=" ms"
              min={10000}
              max={600000}
              step={5000}
              value={globalTimeouts.response_timeout_ms}
              onChange={(val) =>
                setGlobalTimeouts((t) => ({
                  ...t,
                  response_timeout_ms: typeof val === 'number' ? val : t.response_timeout_ms,
                }))
              }
            />
          </SimpleGrid>
          <Title order={6} mb="xs">
            Warning Thresholds
          </Title>
          <Text size="xs" c="dimmed" mb="sm">
            Response times exceeding these values flag a check as &quot;warning&quot; (yellow) instead of pass.
          </Text>
          <SimpleGrid cols={3} mb="md">
            <NumberInput
              label="Slow Page Load"
              suffix=" ms"
              min={1000}
              max={300000}
              step={1000}
              value={globalTimeouts.slow_page_load_ms}
              onChange={(val) =>
                setGlobalTimeouts((t) => ({
                  ...t,
                  slow_page_load_ms: typeof val === 'number' ? val : t.slow_page_load_ms,
                }))
              }
            />
            <NumberInput
              label="Slow Widget Load"
              suffix=" ms"
              min={1000}
              max={300000}
              step={1000}
              value={globalTimeouts.slow_widget_load_ms}
              onChange={(val) =>
                setGlobalTimeouts((t) => ({
                  ...t,
                  slow_widget_load_ms: typeof val === 'number' ? val : t.slow_widget_load_ms,
                }))
              }
            />
            <NumberInput
              label="Slow AI Response"
              suffix=" ms"
              min={1000}
              max={300000}
              step={1000}
              value={globalTimeouts.slow_response_ms}
              onChange={(val) =>
                setGlobalTimeouts((t) => ({
                  ...t,
                  slow_response_ms: typeof val === 'number' ? val : t.slow_response_ms,
                }))
              }
            />
          </SimpleGrid>
          <Group justify="flex-end">
            <Button variant="light" onClick={() => setSettingsOpen(false)}>
              Cancel
            </Button>
            <Button loading={savingSettings} onClick={handleSaveSettings}>
              Save Defaults
            </Button>
          </Group>
        </Card>
      </Collapse>

      {checks.length === 0 ? (
        <Center py="xl">
          <Stack align="center" gap="xs">
            <IconWorldWww size={48} color="gray" />
            <Text c="dimmed">No widget health checks configured yet.</Text>
          </Stack>
        </Center>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th />
              <Table.Th>Name</Table.Th>
              <Table.Th>URL</Table.Th>
              <Table.Th>Cadence</Table.Th>
              <Table.Th>Health</Table.Th>
              <Table.Th>Enabled</Table.Th>
              <Table.Th>Last Run</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {checks.map((check) => (
              <WidgetCheckRow
                key={check.id}
                check={check}
                expanded={expandedId === check.id}
                running={runningId === check.id}
                onExpand={() => handleExpand(check.id)}
                onEdit={() => handleEditOpen(check)}
                onDelete={() => handleDeleteOpen(check)}
                onRunNow={() => handleRunNow(check.id)}
              />
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal
        opened={createOpened}
        onClose={() => {
          closeCreate();
          setForm(EMPTY_FORM);
          setAdvancedOpen(false);
        }}
        title="New Widget Check"
        size="lg"
      >
        {createOpened && (
          <>
            {formModal}
            <Group justify="flex-end" mt="lg">
              <Button variant="default" onClick={closeCreate}>
                Cancel
              </Button>
              <Button onClick={handleCreate} loading={saving} disabled={!form.name || !form.url}>
                Create
              </Button>
            </Group>
          </>
        )}
      </Modal>

      <Modal opened={editOpened} onClose={closeEdit} title="Edit Widget Check" size="lg">
        {editOpened && (
          <>
            {formModal}
            <Group justify="flex-end" mt="lg">
              <Button variant="default" onClick={closeEdit}>
                Cancel
              </Button>
              <Button onClick={handleUpdate} loading={saving} disabled={!form.name || !form.url}>
                Save
              </Button>
            </Group>
          </>
        )}
      </Modal>

      <Modal opened={deleteOpened} onClose={closeDelete} title="Delete Widget Check" size="sm">
        <Text>
          Are you sure you want to delete <strong>{deletingCheck?.name}</strong>? This will also remove all associated
          runs and incidents.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={closeDelete}>
            Cancel
          </Button>
          <Button color="red" onClick={handleDelete} loading={saving}>
            Delete
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}

interface WidgetCheckRowProps {
  check: WidgetHcCheck;
  expanded: boolean;
  running: boolean;
  onExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRunNow: () => void;
}

function WidgetCheckRow({ check, expanded, running, onExpand, onEdit, onDelete, onRunNow }: WidgetCheckRowProps) {
  return (
    <>
      <Table.Tr style={{ cursor: 'pointer' }} onClick={onExpand}>
        <Table.Td>{expanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}</Table.Td>
        <Table.Td>{check.name}</Table.Td>
        <Table.Td onClick={(e) => e.stopPropagation()}>
          <Tooltip label={check.url} disabled={check.url.length <= 40}>
            <Anchor href={check.url} target="_blank" rel="noopener noreferrer" size="sm">
              {extractDomain(check.url)}
            </Anchor>
          </Tooltip>
        </Table.Td>
        <Table.Td>{check.cadence_minutes} min</Table.Td>
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
        <Table.Td>{relativeTime(check.last_run_at)}</Table.Td>
        <Table.Td onClick={(e) => e.stopPropagation()}>
          <Group gap="xs">
            <Tooltip label={running ? 'Running…' : 'Run Now'}>
              <ActionIcon variant="subtle" color="blue" onClick={onRunNow} aria-label="Run Now" disabled={running}>
                {running ? <Loader size={16} /> : <IconPlayerPlay size={16} />}
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
        <Table.Td colSpan={9} p={0} style={{ border: expanded ? undefined : 'none' }}>
          <Collapse in={expanded}>
            <Box p="md">
              <InvestigationPanel checkId={check.id} checkType="widget" />
            </Box>
          </Collapse>
        </Table.Td>
      </Table.Tr>
    </>
  );
}
