/**
 * Page – WorkflowEditorPage
 * Full-page editor for creating/editing workflows with drag-and-drop
 * variable mapping. Replaces the modal-based editor from WorkflowManager.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Stack,
  Group,
  Button,
  Text,
  Loader,
  Center,
  Breadcrumbs,
  Anchor,
  ActionIcon,
  Tooltip,
  Drawer,
  Badge,
  ScrollArea,
  Table,
  Code,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconDeviceFloppy, IconTestPipe, IconHistory } from '@tabler/icons-react';
import * as api from '../services/api';
import type {
  Workflow,
  WorkflowStep,
  ProcessingJob,
  AiProfile,
  ChatSession,
  WorkflowStepConfig,
  WorkflowInputVariable,
} from '../types/api';
import { slugify } from '../lib/slugify';
import WorkflowStepSidebar from '../components/molecules/WorkflowStepSidebar';
import WorkflowInputEditor, { type InputVariableFormItem } from '../components/molecules/WorkflowInputEditor';
import StepVariableMapper, { type AvailableVariable } from '../components/molecules/StepVariableMapper';
import WorkflowExecutionLog from '../components/organisms/WorkflowExecutionLog';

type NavigateFn = (key: string, params?: Record<string, unknown>) => void;

interface Props {
  onNavigate: NavigateFn;
  pageParams: Record<string, unknown>;
}

interface WorkflowFormData {
  name: string;
  slug: string;
  description: string;
  ai_profile_id: string | null;
  is_active: boolean;
  inputVariables: InputVariableFormItem[];
}

interface WorkflowStepFormData {
  _uid: string;
  id?: string;
  step_key: string;
  name: string;
  processing_job_id: string | null;
  sort_order?: number;
  is_required?: boolean;
  depends_on: string[];
  config: WorkflowStepConfig;
}

function uid(): string {
  return crypto.randomUUID();
}

export default function WorkflowEditorPage({ onNavigate, pageParams }: Props) {
  const workflowId = pageParams.workflowId as string | undefined;
  const isEditing = !!workflowId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [profiles, setProfiles] = useState<AiProfile[]>([]);
  const [existingWorkflow, setExistingWorkflow] = useState<Workflow | null>(null);

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  const [execDrawerOpened, { open: openExecDrawer, close: closeExecDrawer }] = useDisclosure(false);
  const [execSessions, setExecSessions] = useState<ChatSession[]>([]);
  const [execLoading, setExecLoading] = useState(false);
  const [selectedExecSession, setSelectedExecSession] = useState<string | null>(null);

  const [form, setForm] = useState<WorkflowFormData>({
    name: '',
    slug: '',
    description: '',
    ai_profile_id: null,
    is_active: true,
    inputVariables: [],
  });
  const [steps, setSteps] = useState<WorkflowStepFormData[]>([]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [jobsResult, profilesResult] = await Promise.all([api.listProcessingJobs(), api.listAiProfiles()]);
      setJobs(jobsResult.data || []);
      setProfiles(profilesResult.data || []);

      if (workflowId) {
        const wf = await api.getWorkflow(workflowId);
        setExistingWorkflow(wf);
        setForm({
          name: wf.name || '',
          slug: wf.slug || '',
          description: wf.description || '',
          ai_profile_id: wf.ai_profile_id || null,
          is_active: wf.is_active !== false,
          inputVariables: (wf.config?.inputVariables || []).map((v: WorkflowInputVariable) => ({
            ...v,
            _uid: uid(),
          })),
        });
        const loadedSteps = (wf.steps || []).map((s: WorkflowStep) => ({
          _uid: uid(),
          id: s.id,
          step_key: s.step_key,
          name: s.name,
          processing_job_id: s.processing_job_id,
          sort_order: s.sort_order,
          is_required: s.is_required,
          depends_on: s.depends_on || [],
          config: (s.config || {}) as WorkflowStepConfig,
        }));
        setSteps(loadedSteps);
      } else {
        const defaultProfile = profilesResult.data?.find((p: AiProfile) => p.is_default && p.is_active);
        setForm((prev) => ({
          ...prev,
          ai_profile_id: defaultProfile?.id || null,
        }));
      }
    } catch (err: unknown) {
      notifications.show({
        title: 'Error loading data',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const profileOptions = useMemo(
    () =>
      profiles
        .filter((p) => p.is_active !== false)
        .map((p) => ({ value: p.id, label: `${p.name}${p.mode ? ` (${p.mode})` : ''}` })),
    [profiles],
  );

  const allStepKeys = useMemo(() => steps.map((s) => s.step_key).filter(Boolean), [steps]);

  function getAvailableVarsForStep(stepIndex: number): AvailableVariable[] {
    const vars: AvailableVariable[] = form.inputVariables
      .filter((v) => (v.name ?? '').trim())
      .map((v) => ({ name: v.name, source: 'Application Call' }));

    for (let i = 0; i < stepIndex; i++) {
      const s = steps[i];
      if (!s) continue;
      const outputMappings = s.config?.outputMappings || {};
      for (const workflowVar of Object.values(outputMappings)) {
        if (workflowVar && !vars.some((v) => v.name === workflowVar)) {
          vars.push({ name: workflowVar, source: `Step ${i + 1}: ${s.name || s.step_key}` });
        }
      }
      if (s.step_key) {
        const promptVar = `${s.step_key}.prompt`;
        const responseVar = `${s.step_key}.response`;
        if (!vars.some((v) => v.name === promptVar)) {
          vars.push({ name: promptVar, source: `auto: ${s.name || s.step_key}` });
        }
        if (!vars.some((v) => v.name === responseVar)) {
          vars.push({ name: responseVar, source: `auto: ${s.name || s.step_key}` });
        }
      }
    }
    return vars;
  }

  function addStep() {
    const newStep: WorkflowStepFormData = {
      _uid: uid(),
      step_key: '',
      name: '',
      processing_job_id: null,
      sort_order: steps.length,
      is_required: false,
      depends_on: [],
      config: {},
    };
    setSteps((prev) => [...prev, newStep]);
    setSelectedStepId(newStep._uid);
  }

  function updateStep(index: number, updates: Partial<WorkflowStepFormData>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...updates } : s)));
  }

  function moveStep(index: number, direction: number) {
    setSteps((prev) => {
      const arr = [...prev];
      const target = index + direction;
      if (target < 0 || target >= arr.length) return arr;
      const a = arr[index];
      const b = arr[target];
      if (!a || !b) return arr;
      arr[index] = b;
      arr[target] = a;
      return arr;
    });
  }

  function removeStep(index: number) {
    const removed = steps[index];
    if (removed && selectedStepId === removed._uid) {
      setSelectedStepId(null);
    }
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      notifications.show({ title: 'Required', message: 'Name is required.', color: 'yellow' });
      return;
    }
    const invalidStep = steps.find((s) => !s.step_key || !s.processing_job_id || !s.name);
    if (invalidStep) {
      notifications.show({
        title: 'Incomplete step',
        message: 'Every step needs a key, name, and processing job.',
        color: 'yellow',
      });
      return;
    }

    try {
      setSaving(true);
      const payload = {
        name: form.name.trim(),
        slug: slugify(form.slug || form.name),
        description: form.description.trim() || null,
        ai_profile_id: form.ai_profile_id || null,
        is_active: form.is_active,
        config: {
          ...(existingWorkflow?.config || {}),
          inputVariables: form.inputVariables.filter((v) => (v.name ?? '').trim()).map(({ _uid: _, ...rest }) => rest),
        },
        steps: steps.map((s, i) => ({
          processing_job_id: s.processing_job_id,
          step_key: s.step_key,
          name: s.name,
          sort_order: i,
          is_required: s.is_required || false,
          depends_on: s.depends_on || [],
          config: s.config || {},
        })),
      };

      if (isEditing && existingWorkflow) {
        await api.updateWorkflow(existingWorkflow.id, payload);
        notifications.show({
          title: 'Updated',
          message: `Workflow "${form.name}" updated.`,
          color: 'green',
        });
      } else {
        const created = await api.createWorkflow(payload);
        notifications.show({
          title: 'Created',
          message: `Workflow "${form.name}" created.`,
          color: 'green',
        });
        onNavigate('workflow-editor', { workflowId: created.id });
        return;
      }
      await loadData();
    } catch (err: unknown) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  }

  function viewExecutions() {
    if (!workflowId) return;
    setSelectedExecSession(null);
    openExecDrawer();
    setExecLoading(true);
    api
      .listChatSessions({ workflowId, limit: 20 })
      .then((result) => setExecSessions(result.data))
      .catch(() => setExecSessions([]))
      .finally(() => setExecLoading(false));
  }

  const selectedStepIndex = steps.findIndex((s) => s._uid === selectedStepId);
  const selectedStep = selectedStepIndex >= 0 ? steps[selectedStepIndex] : null;

  if (loading) {
    return (
      <Center p="xl" h={400}>
        <Loader />
      </Center>
    );
  }

  return (
    <Stack gap="md" h="100%">
      {/* Header */}
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm">
          <Tooltip label="Back to Workflows">
            <ActionIcon variant="subtle" size="lg" onClick={() => onNavigate('workflows')}>
              <IconArrowLeft size={20} />
            </ActionIcon>
          </Tooltip>
          <Breadcrumbs>
            <Anchor
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('workflows');
              }}
            >
              Workflows
            </Anchor>
            <Text size="sm" fw={600}>
              {isEditing ? form.name || 'Edit Workflow' : 'New Workflow'}
            </Text>
          </Breadcrumbs>
        </Group>
        <Group gap="sm">
          <Button
            variant="default"
            leftSection={<IconHistory size={16} />}
            disabled={!isEditing}
            onClick={viewExecutions}
          >
            Diagnostics
          </Button>
          <Button
            variant="default"
            leftSection={<IconTestPipe size={16} />}
            disabled={!isEditing}
            onClick={() => {
              if (existingWorkflow) {
                onNavigate('workflows', { autoTest: existingWorkflow.id });
              }
            }}
          >
            Test Run
          </Button>
          <Button leftSection={<IconDeviceFloppy size={16} />} loading={saving} onClick={handleSave}>
            {isEditing ? 'Save Changes' : 'Create Workflow'}
          </Button>
        </Group>
      </Group>

      {/* Body: sidebar + content */}
      <Group align="flex-start" gap="md" wrap="nowrap" style={{ flex: 1 }}>
        <WorkflowStepSidebar
          steps={steps}
          selectedId={selectedStepId}
          onSelect={setSelectedStepId}
          onAddStep={addStep}
          onMoveStep={moveStep}
          onRemoveStep={removeStep}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedStepId === null && (
            <WorkflowInputEditor
              form={form}
              onChange={(updates) => setForm((prev) => ({ ...prev, ...updates }))}
              profileOptions={profileOptions}
            />
          )}

          {selectedStep && selectedStepIndex >= 0 && (
            <StepVariableMapper
              step={selectedStep}
              stepIndex={selectedStepIndex}
              jobs={jobs}
              allStepKeys={allStepKeys}
              availableVars={getAvailableVarsForStep(selectedStepIndex)}
              onUpdate={(updates) => updateStep(selectedStepIndex, updates)}
            />
          )}
        </div>
      </Group>

      {/* Executions drawer */}
      <Drawer
        opened={execDrawerOpened}
        onClose={closeExecDrawer}
        title={
          <Group gap="xs">
            <IconHistory size={18} />
            <Text fw={600}>Diagnostics</Text>
            {execSessions.length > 0 && (
              <Badge size="sm" variant="light">
                {execSessions.length}
              </Badge>
            )}
          </Group>
        }
        position="right"
        size="xl"
        padding="md"
      >
        {execLoading ? (
          <Center p="xl">
            <Loader size="sm" />
          </Center>
        ) : execSessions.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" py="xl">
            No execution data yet. Run the workflow to see diagnostics here.
          </Text>
        ) : selectedExecSession && existingWorkflow?.steps ? (
          <Stack gap="sm">
            <Button
              variant="subtle"
              size="xs"
              onClick={() => setSelectedExecSession(null)}
              leftSection={<IconArrowLeft size={14} />}
            >
              Back to sessions
            </Button>
            <WorkflowExecutionLog sessionId={selectedExecSession} steps={existingWorkflow.steps} />
          </Stack>
        ) : (
          <ScrollArea>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Session</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Messages</Table.Th>
                  <Table.Th>Started</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {execSessions.map((s) => (
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
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Drawer>
    </Stack>
  );
}
