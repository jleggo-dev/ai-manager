import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import * as api from '../../services/api';
import type {
  Workflow,
  WorkflowStep,
  ProcessingJob,
  AiProfile,
  ChatSession,
  WorkflowInputVariable,
} from '../../types/api';
import { slugify } from '../../lib/slugify';
import { getAvailableVarsForStep, uid } from './helpers';
import type { NavigateFn, WorkflowFormData, WorkflowStepFormData } from './types';

export function useWorkflowEditorPage(onNavigate: NavigateFn, workflowId: string | undefined) {
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
          config: s.config || {},
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

  return {
    isEditing,
    loading,
    saving,
    jobs,
    existingWorkflow,
    selectedStepId,
    setSelectedStepId,
    execDrawerOpened,
    closeExecDrawer,
    execSessions,
    execLoading,
    selectedExecSession,
    setSelectedExecSession,
    form,
    setForm,
    steps,
    profileOptions,
    allStepKeys,
    addStep,
    updateStep,
    moveStep,
    removeStep,
    handleSave,
    viewExecutions,
    selectedStepIndex,
    selectedStep,
    getAvailableVarsForStep: (stepIndex: number) => getAvailableVarsForStep(form, steps, stepIndex),
  };
}
