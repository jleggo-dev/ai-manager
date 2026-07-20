import { useState, useEffect, useCallback, useMemo } from 'react';
import { notifications } from '@mantine/notifications';
import * as api from '../../services/api';
import type { ChatSession } from '../../types/api';
import { filterAndSortSessions, type SessionSortDir, type SessionSortField, type WorkflowDetail } from './types';

export function useWorkflowDetailPage(workflowId: string | undefined) {
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [execSessions, setExecSessions] = useState<ChatSession[]>([]);
  const [execLoading, setExecLoading] = useState(false);
  const [selectedExecSession, setSelectedExecSession] = useState<string | null>(null);

  const [sortField, setSortField] = useState<SessionSortField>('created_at');
  const [sortDir, setSortDir] = useState<SessionSortDir>('desc');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  function toggleSort(field: SessionSortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'created_at' ? 'desc' : 'asc');
    }
  }

  const filteredSorted = useMemo(
    () => filterAndSortSessions(execSessions, { sortField, sortDir, statusFilter, searchQuery }),
    [execSessions, statusFilter, searchQuery, sortField, sortDir],
  );

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

  return {
    detail,
    loading,
    execSessions,
    execLoading,
    selectedExecSession,
    setSelectedExecSession,
    sortField,
    sortDir,
    statusFilter,
    setStatusFilter,
    searchQuery,
    setSearchQuery,
    toggleSort,
    filteredSorted,
  };
}
