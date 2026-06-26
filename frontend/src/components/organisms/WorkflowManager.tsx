/**
 * Organism – WorkflowManager
 * ----------------------------
 * Workflow list with delete/test modals.
 * Detail view is a full page (WorkflowDetailPage).
 * Create and edit are handled by the full-page WorkflowEditorPage.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Stack,
  Group,
  Button,
  Modal,
  Loader,
  Center,
  Alert,
  Text,
  Badge,
  ActionIcon,
  Tooltip,
  Card,
  SimpleGrid,
  Code,
  Table,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconPlus,
  IconTrash,
  IconEdit,
  IconAlertCircle,
  IconGitMerge,
  IconTestPipe,
  IconLayoutGrid,
  IconList,
} from '@tabler/icons-react';
import * as api from '../../services/api';
import type { Workflow, ProcessingJob, AiProfile } from '../../types/api';
import WorkflowTestSimulator from './WorkflowTestSimulator';

interface WorkflowStepDetail {
  id?: string;
  step_key: string;
  name: string;
  processing_job_id: string;
  processing_job?: ProcessingJob | null;
  sort_order?: number;
  is_required?: boolean;
  depends_on?: string[];
  config?: Record<string, unknown>;
}

interface WorkflowListItem extends Workflow {
  ai_profile?: AiProfile | null;
}

interface WorkflowDetail extends Omit<Workflow, 'steps'> {
  steps?: WorkflowStepDetail[];
  ai_profile?: AiProfile | null;
}

type NavigateFn = (key: string, params?: Record<string, unknown>) => void;

interface Props {
  onNavigate?: NavigateFn;
  autoTestWorkflowId?: string;
}

export default function WorkflowManager({ onNavigate, autoTestWorkflowId }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [deleteTarget, setDeleteTarget] = useState<Workflow | null>(null);
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] = useDisclosure(false);
  const [testTarget, setTestTarget] = useState<WorkflowDetail | null>(null);
  const [testOpened, { open: openTest, close: closeTest }] = useDisclosure(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const wfsResult = await api.listWorkflows();
      setWorkflows(wfsResult.data || []);
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!autoTestWorkflowId || loading || workflows.length === 0) return;
    const wf = workflows.find((w) => w.id === autoTestWorkflowId);
    if (!wf) return;
    api
      .getWorkflow(wf.id)
      .then((full) => {
        setTestTarget(full as WorkflowDetail);
        openTest();
      })
      .catch((err: unknown) => {
        notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
      });
  }, [autoTestWorkflowId, loading, workflows, openTest]);

  function confirmDelete(workflow: Workflow) {
    setDeleteTarget(workflow);
    openDeleteModal();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api.deleteWorkflow(deleteTarget.id);
      notifications.show({ title: 'Deleted', message: `Workflow "${deleteTarget.name}" deleted.`, color: 'orange' });
      closeDeleteModal();
      setDeleteTarget(null);
      await loadData();
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    }
  }

  async function viewTest(workflow: Workflow) {
    try {
      const full = await api.getWorkflow(workflow.id);
      setTestTarget(full as WorkflowDetail);
      openTest();
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    }
  }

  if (loading) {
    return (
      <Center p="xl">
        <Loader />
      </Center>
    );
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {workflows.length} workflow{workflows.length !== 1 ? 's' : ''}
        </Text>
        <Group gap="xs">
          <Tooltip label="Card view">
            <ActionIcon variant={viewMode === 'card' ? 'filled' : 'subtle'} onClick={() => setViewMode('card')}>
              <IconLayoutGrid size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="List view">
            <ActionIcon variant={viewMode === 'list' ? 'filled' : 'subtle'} onClick={() => setViewMode('list')}>
              <IconList size={16} />
            </ActionIcon>
          </Tooltip>
          <Button leftSection={<IconPlus size={16} />} onClick={() => onNavigate?.('workflow-editor', {})}>
            New Workflow
          </Button>
        </Group>
      </Group>

      {workflows.length === 0 ? (
        <Alert icon={<IconAlertCircle size={18} />} color="blue" variant="light">
          No workflows yet. Create one to group processing jobs into multi-step chat flows.
        </Alert>
      ) : viewMode === 'list' ? (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Slug</Table.Th>
              <Table.Th>Profile</Table.Th>
              <Table.Th>Steps</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th style={{ width: 120 }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {workflows.map((wf) => (
              <Table.Tr
                key={wf.id}
                style={{ cursor: 'pointer' }}
                onClick={() => onNavigate?.('workflow-detail', { workflowId: wf.id })}
              >
                <Table.Td>
                  <Group gap="xs">
                    <IconGitMerge size={14} opacity={0.5} />
                    <Text size="sm" fw={500}>
                      {wf.name}
                    </Text>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Code style={{ fontSize: 11 }}>{wf.slug}</Code>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">{wf.ai_profile?.name || '—'}</Text>
                </Table.Td>
                <Table.Td>
                  <Badge size="xs" variant="outline">
                    {wf.steps?.length || 0}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Badge size="xs" variant="light" color={wf.is_active ? 'green' : 'gray'}>
                    {wf.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    <Tooltip label="Test">
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        color="teal"
                        onClick={(e) => {
                          e.stopPropagation();
                          viewTest(wf);
                        }}
                      >
                        <IconTestPipe size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Edit">
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigate?.('workflow-editor', { workflowId: wf.id });
                        }}
                      >
                        <IconEdit size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Delete">
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        color="red"
                        onClick={(e) => {
                          e.stopPropagation();
                          confirmDelete(wf);
                        }}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          {workflows.map((wf) => (
            <Card
              key={wf.id}
              shadow="xs"
              padding="md"
              withBorder
              style={{ cursor: 'pointer' }}
              onClick={() => onNavigate?.('workflow-detail', { workflowId: wf.id })}
            >
              <Group justify="space-between" mb="xs">
                <Group gap="xs">
                  <IconGitMerge size={18} opacity={0.5} />
                  <Text fw={600} size="sm">
                    {wf.name}
                  </Text>
                </Group>
                <Group gap={4}>
                  <Badge size="xs" variant="light" color={wf.is_active ? 'green' : 'gray'}>
                    {wf.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                  <Badge size="xs" variant="outline">
                    {wf.steps?.length || 0} step{(wf.steps?.length || 0) !== 1 ? 's' : ''}
                  </Badge>
                </Group>
              </Group>
              {wf.description && (
                <Text size="xs" c="dimmed" mb="xs" lineClamp={2}>
                  {wf.description}
                </Text>
              )}
              <Group gap="xs" mb="xs">
                <Text size="xs" c="dimmed">
                  Profile:
                </Text>
                <Text size="xs">{wf.ai_profile?.name || '(none)'}</Text>
              </Group>
              <Code block style={{ fontSize: 11 }}>
                {wf.slug}
              </Code>
              <Group mt="sm" gap="xs">
                <Tooltip label="Test workflow">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    color="teal"
                    onClick={(e) => {
                      e.stopPropagation();
                      viewTest(wf);
                    }}
                  >
                    <IconTestPipe size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Edit">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigate?.('workflow-editor', { workflowId: wf.id });
                    }}
                  >
                    <IconEdit size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Delete">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    color="red"
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmDelete(wf);
                    }}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Card>
          ))}
        </SimpleGrid>
      )}

      {/* Delete Confirmation */}
      <Modal opened={deleteModalOpened} onClose={closeDeleteModal} title="Delete Workflow" size="sm">
        <Stack gap="sm">
          <Text size="sm">
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This will remove the workflow and all
            its step configurations. The underlying processing jobs will not be affected.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={closeDeleteModal}>
              Cancel
            </Button>
            <Button color="red" onClick={handleDelete}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Test Simulator Modal */}
      <Modal
        opened={testOpened}
        onClose={closeTest}
        title={testTarget ? `Test: ${testTarget.name}` : 'Test Workflow'}
        size="xl"
        fullScreen
      >
        {testTarget && <WorkflowTestSimulator workflow={testTarget} onClose={closeTest} />}
      </Modal>
    </Stack>
  );
}
