import { useState, useEffect, useCallback } from 'react';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import * as api from '../../../services/api';
import type { Workflow } from '../../../types/api';
import type { ViewMode, WorkflowDetail, WorkflowListItem } from './types';

export function useWorkflowManager(autoTestWorkflowId?: string) {
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [viewMode, setViewMode] = useState<ViewMode>('list');
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

  return {
    workflows,
    loading,
    viewMode,
    setViewMode,
    deleteTarget,
    deleteModalOpened,
    closeDeleteModal,
    testTarget,
    testOpened,
    closeTest,
    confirmDelete,
    handleDelete,
    viewTest,
  };
}
