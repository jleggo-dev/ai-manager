/**
 * Full-page workflow detail view with executions tab.
 * Navigated to by clicking a workflow card on the Workflows list page.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Stack,
  Group,
  Text,
  Code,
  Badge,
  Button,
  Table,
  Tabs,
  Divider,
  Center,
  Loader,
  Alert,
  ScrollArea,
  TextInput,
  Select,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconArrowLeft,
  IconHistory,
  IconEdit,
  IconTestPipe,
  IconChevronUp,
  IconChevronDown,
  IconSelector,
  IconSearch,
} from '@tabler/icons-react';
import PageHeader from '../components/atoms/PageHeader';
import WorkflowVariablePanel from '../components/organisms/WorkflowVariablePanel';
import WorkflowExecutionLog from '../components/organisms/WorkflowExecutionLog';
import * as api from '../services/api';
import type { AiProfile, ChatSession, WorkflowStep, ProcessingJob } from '../types/api';

interface WorkflowDetail {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  is_active?: boolean;
  ai_profile_id?: string | null;
  ai_profile?: AiProfile | null;
  config?: Record<string, unknown>;
  steps?: (WorkflowStep & { processing_job?: ProcessingJob | null })[];
}

type NavigateFn = (key: string, params?: Record<string, unknown>) => void;

interface Props {
  onNavigate: NavigateFn;
  pageParams: Record<string, unknown>;
}

export default function WorkflowDetailPage({ onNavigate, pageParams }: Props) {
  const workflowId = pageParams.workflowId as string | undefined;

  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [execSessions, setExecSessions] = useState<ChatSession[]>([]);
  const [execLoading, setExecLoading] = useState(false);
  const [selectedExecSession, setSelectedExecSession] = useState<string | null>(null);

  type SortField = 'id' | 'status' | 'message_count' | 'created_at';
  type SortDir = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'created_at' ? 'desc' : 'asc');
    }
  }

  const filteredSorted = useMemo(() => {
    let result = [...execSessions];

    if (statusFilter) result = result.filter((s) => s.status === statusFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (s) => s.id.toLowerCase().includes(q) || (s.calling_application || '').toLowerCase().includes(q),
      );
    }

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'id':
          cmp = a.id.localeCompare(b.id);
          break;
        case 'status':
          cmp = (a.status || '').localeCompare(b.status || '');
          break;
        case 'message_count':
          cmp = (a.message_count ?? 0) - (b.message_count ?? 0);
          break;
        case 'created_at':
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [execSessions, statusFilter, searchQuery, sortField, sortDir]);

  const loadWorkflow = useCallback(async () => {
    if (!workflowId) return;
    try {
      setLoading(true);
      const full = await api.getWorkflow(workflowId);
      setDetail(full as WorkflowDetail);

      setExecLoading(true);
      api
        .listChatSessions({ workflowId, limit: 50 })
        .then((result) => setExecSessions(result.data))
        .catch(() => setExecSessions([]))
        .finally(() => setExecLoading(false));
    } catch (err: unknown) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    loadWorkflow();
  }, [loadWorkflow]);

  if (!workflowId) {
    return (
      <Stack gap="md">
        <Alert color="yellow">No workflow selected.</Alert>
        <Button variant="light" onClick={() => onNavigate('workflows', {})}>
          Back to Workflows
        </Button>
      </Stack>
    );
  }

  if (loading) {
    return (
      <Center p="xl">
        <Loader />
      </Center>
    );
  }

  if (!detail) {
    return (
      <Stack gap="md">
        <Alert color="red">Workflow not found.</Alert>
        <Button variant="light" onClick={() => onNavigate('workflows', {})}>
          Back to Workflows
        </Button>
      </Stack>
    );
  }

  const inputVariables = detail.config?.inputVariables as
    | { name: string; label?: string; description?: string; required?: boolean }[]
    | undefined;

  return (
    <Stack gap="md">
      <PageHeader title={detail.name} description={detail.description || undefined}>
        <Group gap="xs">
          <Button
            variant="subtle"
            size="sm"
            leftSection={<IconArrowLeft size={16} />}
            onClick={() => onNavigate('workflows', {})}
          >
            Back
          </Button>
          <Button
            variant="light"
            size="sm"
            leftSection={<IconEdit size={16} />}
            onClick={() => onNavigate('workflow-editor', { workflowId: detail.id })}
          >
            Edit
          </Button>
          <Button
            variant="light"
            size="sm"
            color="teal"
            leftSection={<IconTestPipe size={16} />}
            onClick={() => onNavigate('workflows', { autoTest: detail.id })}
          >
            Test
          </Button>
        </Group>
      </PageHeader>

      <Group gap="xs">
        <Badge size="sm" variant="light" color={detail.is_active ? 'green' : 'gray'}>
          {detail.is_active ? 'Active' : 'Inactive'}
        </Badge>
        <Code>{detail.slug}</Code>
        <Text size="sm">
          <strong>Profile:</strong> {detail.ai_profile?.name || '(none)'}
        </Text>
      </Group>

      <Tabs defaultValue="steps">
        <Tabs.List>
          <Tabs.Tab value="steps">Steps</Tabs.Tab>
          <Tabs.Tab value="diagnostics" leftSection={<IconHistory size={14} />}>
            Diagnostics
            {execSessions.length > 0 && (
              <Badge size="xs" variant="light" ml={4}>
                {execSessions.length}
              </Badge>
            )}
          </Tabs.Tab>
        </Tabs.List>

        {/* ── Steps tab ──────────────────────────────────────────── */}
        <Tabs.Panel value="steps" pt="sm">
          <Stack gap="sm">
            {(!detail.steps || detail.steps.length === 0) && (
              <Text size="sm" c="dimmed" ta="center">
                No steps configured.
              </Text>
            )}

            {detail.steps && detail.steps.length > 0 && (
              <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>#</Table.Th>
                    <Table.Th>Step Key</Table.Th>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Processing Job</Table.Th>
                    <Table.Th>Required</Table.Th>
                    <Table.Th>Depends On</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {detail.steps.map((s, i) => (
                    <Table.Tr key={s.id || i}>
                      <Table.Td>{i + 1}</Table.Td>
                      <Table.Td>
                        <Code>{s.step_key}</Code>
                      </Table.Td>
                      <Table.Td>{s.name}</Table.Td>
                      <Table.Td>{s.processing_job?.name || s.processing_job_id}</Table.Td>
                      <Table.Td>{s.is_required ? 'Yes' : 'No'}</Table.Td>
                      <Table.Td>{s.depends_on?.length ? s.depends_on.join(', ') : '—'}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}

            {detail.steps && detail.steps.length > 0 && (
              <>
                <Divider label="Variable Flow" labelPosition="center" />
                <WorkflowVariablePanel steps={detail.steps} inputVariables={inputVariables} />
              </>
            )}
          </Stack>
        </Tabs.Panel>

        {/* ── Diagnostics tab ────────────────────────────────────── */}
        <Tabs.Panel value="diagnostics" pt="sm">
          {execLoading ? (
            <Center p="md">
              <Loader size="sm" />
            </Center>
          ) : execSessions.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="md">
              No workflow executions found. Run the workflow to see execution logs here.
            </Text>
          ) : selectedExecSession && detail.steps ? (
            <Stack gap="sm">
              <Button
                variant="subtle"
                size="xs"
                onClick={() => setSelectedExecSession(null)}
                leftSection={<IconHistory size={14} />}
              >
                Back to session list
              </Button>
              <WorkflowExecutionLog sessionId={selectedExecSession} steps={detail.steps} />
            </Stack>
          ) : (
            <Stack gap="sm">
              <Group gap="sm">
                <TextInput
                  placeholder="Search by session ID…"
                  size="xs"
                  leftSection={<IconSearch size={14} />}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.currentTarget.value)}
                  style={{ flex: 1, maxWidth: 260 }}
                />
                <Select
                  placeholder="All statuses"
                  size="xs"
                  clearable
                  data={[
                    { value: 'active', label: 'Active' },
                    { value: 'closed', label: 'Closed' },
                  ]}
                  value={statusFilter}
                  onChange={setStatusFilter}
                  style={{ width: 140 }}
                />
                <Text size="xs" c="dimmed">
                  {filteredSorted.length} of {execSessions.length} sessions
                </Text>
              </Group>

              <ScrollArea>
                <Table striped highlightOnHover withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>
                        <SortableHeader
                          label="Session"
                          field="id"
                          sortField={sortField}
                          sortDir={sortDir}
                          onSort={toggleSort}
                        />
                      </Table.Th>
                      <Table.Th>
                        <SortableHeader
                          label="Status"
                          field="status"
                          sortField={sortField}
                          sortDir={sortDir}
                          onSort={toggleSort}
                        />
                      </Table.Th>
                      <Table.Th>
                        <SortableHeader
                          label="Messages"
                          field="message_count"
                          sortField={sortField}
                          sortDir={sortDir}
                          onSort={toggleSort}
                        />
                      </Table.Th>
                      <Table.Th>
                        <SortableHeader
                          label="Started"
                          field="created_at"
                          sortField={sortField}
                          sortDir={sortDir}
                          onSort={toggleSort}
                        />
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {filteredSorted.length === 0 ? (
                      <Table.Tr>
                        <Table.Td colSpan={4}>
                          <Text size="sm" c="dimmed" ta="center" py="sm">
                            No sessions match the current filters.
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ) : (
                      filteredSorted.map((s) => (
                        <Table.Tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedExecSession(s.id)}>
                          <Table.Td>
                            <Code style={{ fontSize: 11 }}>{s.id.slice(0, 8)}</Code>
                          </Table.Td>
                          <Table.Td>
                            <Badge
                              size="xs"
                              color={s.status === 'active' ? 'green' : s.status === 'closed' ? 'gray' : 'blue'}
                            >
                              {s.status}
                            </Badge>
                          </Table.Td>
                          <Table.Td>{s.message_count ?? 0}</Table.Td>
                          <Table.Td>
                            <Text size="xs">{new Date(s.created_at).toLocaleString()}</Text>
                          </Table.Td>
                        </Table.Tr>
                      ))
                    )}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Stack>
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

function SortableHeader({
  label,
  field,
  sortField,
  sortDir,
  onSort,
}: {
  label: string;
  field: string;
  sortField: string;
  sortDir: 'asc' | 'desc';
  onSort: (field: never) => void;
}) {
  const active = sortField === field;
  const Icon = active ? (sortDir === 'asc' ? IconChevronUp : IconChevronDown) : IconSelector;

  return (
    <UnstyledButton onClick={() => onSort(field as never)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <Text size="xs" fw={600}>
        {label}
      </Text>
      <Icon size={14} style={{ opacity: active ? 1 : 0.4 }} />
    </UnstyledButton>
  );
}
